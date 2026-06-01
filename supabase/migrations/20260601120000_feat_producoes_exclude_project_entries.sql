-- =============================================================================
-- Feat Producoes — Regra fixa: lancamentos com PROJETO vinculado fora da DRE
-- =============================================================================
-- Regra ESPECIFICA da empresa "Feat Producoes" (segmento Feat):
--
--   Na DRE da Feat Producoes, qualquer lancamento que possua PROJETO vinculado
--   (cCodProjeto preenchido) NAO entra na DRE — nem no dashboard, nem no
--   drilldown — EXCETO quando o NOME do projeto comeca exatamente com "N.O."
--   (quatro caracteres: N . O .). Esses entram normalmente, respeitando a
--   categoria/mapeamento configurado.
--
-- Isolamento (requisitos):
--   • Aplica-se SOMENTE a Feat Producoes. Nenhuma outra empresa e afetada —
--     nem outras empresas do segmento Feat. O gate e a flag por empresa
--     `companies.dre_exclude_linked_projects` (default false; ligada apenas
--     para Feat Producoes nesta migration).
--   • Aplicada no PONTO DE LEITURA (RPCs do dashboard/drilldown), antes da
--     montagem dos valores. NAO apaga nem altera lancamentos: os entries
--     continuam existindo em financial_entries para outras telas/consultas.
--   • Sobrevive a novas sincronizacoes: o sync apenas (re)grava
--     project_code/project_name nos entries; a flag fica na tabela companies
--     (intocada pelo sync) e a exclusao e recalculada a cada leitura.
--   • Nao altera categorias, mapeamento, dados da Omie, nem a logica DRE das
--     demais empresas (o predicado e inerte quando a flag e false).
--
-- Origem do dado de projeto:
--   ListarMovimentos so traz cCodProjeto (codigo numerico). O sync resolve o
--   NOME via catalogo de projetos (ListarProjetos) e grava ambos em
--   financial_entries.project_code / project_name. Entry com projeto cujo
--   nome nao foi resolvido (project_name NULL) e tratado como "tem projeto e
--   nao e N.O." -> excluido (default seguro).
-- =============================================================================

-- 1. Colunas de projeto em financial_entries (preenchidas pelo sync).
ALTER TABLE public.financial_entries
  ADD COLUMN IF NOT EXISTS project_code text,
  ADD COLUMN IF NOT EXISTS project_name text;

-- 2. Flag por empresa que liga a regra. Default false => comportamento
--    inalterado para todas as empresas existentes.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS dre_exclude_linked_projects boolean NOT NULL DEFAULT false;

-- 3. Liga a regra apenas para a Feat Producoes (mesma identificacao por nome
--    usada no seed do plano DRE da Feat). Idempotente.
UPDATE public.companies
  SET dre_exclude_linked_projects = true
  WHERE name = 'Feat Producoes';

-- 4. Predicado central da regra: TRUE quando o entry deve ser EXCLUIDO da DRE.
--    Centralizado para que os 3 RPCs apliquem EXATAMENTE a mesma logica e nao
--    divirjam. IMMUTABLE: depende so dos argumentos.
--
--    starts_with(...) e case-sensitive e literal — garante que apenas "N.O."
--    exato (N . O .) seja excecao; "NO.", "N O", "N.O", "no.", "n.o.",
--    "N. O." etc. NAO sao excecao e continuam excluidos.
CREATE OR REPLACE FUNCTION public.dre_entry_excluded_by_project(
  p_exclude_linked_projects boolean,
  p_project_code text,
  p_project_name text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    COALESCE(p_exclude_linked_projects, false)
    AND p_project_code IS NOT NULL
    AND btrim(p_project_code) <> ''
    AND NOT starts_with(COALESCE(p_project_name, ''), 'N.O.');
$$;

GRANT EXECUTE ON FUNCTION public.dre_entry_excluded_by_project(boolean, text, text) TO authenticated;

-- =============================================================================
-- 5. Recria os 3 RPCs da DRE adicionando o predicado de exclusao.
--    Bases: dashboard_dre_aggregate(_by_company) de
--    20260529140000_dashboard_dre_aggregate_with_manual.sql e
--    dashboard_dre_drilldown de 20260522120000_dre_drilldown_match_by_code.sql.
--    Unica mudanca: JOIN companies + AND NOT dre_entry_excluded_by_project(...)
--    no ramo que le financial_entries. manual_account_values fica intacto.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.dashboard_dre_aggregate(
  p_company_ids uuid[],
  p_date_from date,
  p_date_to date
)
RETURNS TABLE (
  dre_account_id uuid,
  amount numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH omie_amounts AS (
    SELECT
      mapping.dre_account_id,
      sum(fe.value)::numeric AS amount
    FROM public.financial_entries fe
    JOIN public.companies co ON co.id = fe.company_id
    CROSS JOIN LATERAL (
      SELECT cm.dre_account_id
      FROM public.category_mapping cm
      WHERE cm.omie_category_code = fe.category_code
        AND (cm.company_id = fe.company_id OR cm.company_id IS NULL)
      ORDER BY cm.company_id NULLS LAST
      LIMIT 1
    ) mapping
    JOIN public.dre_accounts da ON da.id = mapping.dre_account_id
    WHERE fe.payment_date BETWEEN p_date_from AND p_date_to
      AND fe.company_id = ANY(p_company_ids)
      AND fe.category_code IS NOT NULL
      AND da.data_source = 'omie'
      AND NOT public.dre_entry_excluded_by_project(
            co.dre_exclude_linked_projects, fe.project_code, fe.project_name)
    GROUP BY mapping.dre_account_id
  ),
  manual_amounts AS (
    SELECT
      mav.dre_account_id,
      sum(mav.valor)::numeric AS amount
    FROM public.manual_account_values mav
    JOIN public.dre_accounts da ON da.id = mav.dre_account_id
    WHERE mav.company_id = ANY(p_company_ids)
      AND da.data_source <> 'omie'
      AND make_date(mav.ano, mav.mes, 1)
            BETWEEN date_trunc('month', p_date_from)::date
                AND date_trunc('month', p_date_to)::date
    GROUP BY mav.dre_account_id
  )
  SELECT dre_account_id, sum(amount)::numeric AS amount
  FROM (
    SELECT * FROM omie_amounts
    UNION ALL
    SELECT * FROM manual_amounts
  ) combined
  GROUP BY dre_account_id;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_dre_aggregate(uuid[], date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.dashboard_dre_aggregate_by_company(
  p_company_ids uuid[],
  p_date_from date,
  p_date_to date
)
RETURNS TABLE (
  company_id uuid,
  dre_account_id uuid,
  amount numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH omie_amounts AS (
    SELECT
      fe.company_id,
      mapping.dre_account_id,
      sum(fe.value)::numeric AS amount
    FROM public.financial_entries fe
    JOIN public.companies co ON co.id = fe.company_id
    CROSS JOIN LATERAL (
      SELECT cm.dre_account_id
      FROM public.category_mapping cm
      WHERE cm.omie_category_code = fe.category_code
        AND (cm.company_id = fe.company_id OR cm.company_id IS NULL)
      ORDER BY cm.company_id NULLS LAST
      LIMIT 1
    ) mapping
    JOIN public.dre_accounts da ON da.id = mapping.dre_account_id
    WHERE fe.payment_date BETWEEN p_date_from AND p_date_to
      AND fe.company_id = ANY(p_company_ids)
      AND fe.category_code IS NOT NULL
      AND da.data_source = 'omie'
      AND NOT public.dre_entry_excluded_by_project(
            co.dre_exclude_linked_projects, fe.project_code, fe.project_name)
    GROUP BY fe.company_id, mapping.dre_account_id
  ),
  manual_amounts AS (
    SELECT
      mav.company_id,
      mav.dre_account_id,
      sum(mav.valor)::numeric AS amount
    FROM public.manual_account_values mav
    JOIN public.dre_accounts da ON da.id = mav.dre_account_id
    WHERE mav.company_id = ANY(p_company_ids)
      AND da.data_source <> 'omie'
      AND make_date(mav.ano, mav.mes, 1)
            BETWEEN date_trunc('month', p_date_from)::date
                AND date_trunc('month', p_date_to)::date
    GROUP BY mav.company_id, mav.dre_account_id
  )
  SELECT company_id, dre_account_id, sum(amount)::numeric AS amount
  FROM (
    SELECT * FROM omie_amounts
    UNION ALL
    SELECT * FROM manual_amounts
  ) combined
  GROUP BY company_id, dre_account_id;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_dre_aggregate_by_company(uuid[], date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.dashboard_dre_drilldown(
  p_dre_account_id uuid,
  p_company_ids uuid[],
  p_date_from date,
  p_date_to date,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  financial_entry_id uuid,
  payment_date date,
  description text,
  supplier_customer text,
  document_number text,
  value numeric,
  company_id uuid,
  company_name text,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH target AS (
    SELECT code
    FROM public.dre_accounts
    WHERE id = p_dre_account_id
  ),
  base AS (
    SELECT
      fe.id AS financial_entry_id,
      fe.payment_date,
      fe.description,
      fe.supplier_customer,
      fe.document_number,
      fe.value,
      fe.company_id,
      c.name AS company_name
    FROM public.financial_entries fe
    JOIN public.companies c ON c.id = fe.company_id
    CROSS JOIN LATERAL (
      SELECT cm.dre_account_id
      FROM public.category_mapping cm
      WHERE cm.omie_category_code = fe.category_code
        AND (cm.company_id = fe.company_id OR cm.company_id IS NULL)
      ORDER BY cm.company_id NULLS LAST
      LIMIT 1
    ) mapping
    JOIN public.dre_accounts resolved ON resolved.id = mapping.dre_account_id
    WHERE fe.payment_date BETWEEN p_date_from AND p_date_to
      AND fe.company_id = ANY(p_company_ids)
      AND resolved.code = (SELECT code FROM target)
      AND NOT public.dre_entry_excluded_by_project(
            c.dre_exclude_linked_projects, fe.project_code, fe.project_name)
      AND (
        p_search IS NULL
        OR p_search = ''
        OR fe.description ILIKE '%' || p_search || '%'
        OR COALESCE(fe.supplier_customer, '') ILIKE '%' || p_search || '%'
        OR COALESCE(fe.document_number, '') ILIKE '%' || p_search || '%'
      )
      AND (
        c.has_department_apportionment IS NOT TRUE
        OR EXISTS (
          SELECT 1
          FROM public.company_departments cd
          WHERE cd.company_id = fe.company_id
            AND cd.included = true
            AND cd.omie_code = COALESCE(fe.department_code, '__none__')
        )
      )
  ),
  counted AS (
    SELECT
      base.*,
      count(*) OVER() AS total_count
    FROM base
    ORDER BY base.payment_date DESC, base.financial_entry_id DESC
    LIMIT p_limit
    OFFSET p_offset
  )
  SELECT
    counted.financial_entry_id,
    counted.payment_date,
    counted.description,
    counted.supplier_customer,
    counted.document_number,
    counted.value,
    counted.company_id,
    counted.company_name,
    counted.total_count
  FROM counted;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_dre_drilldown(uuid, uuid[], date, date, text, integer, integer) TO authenticated;
