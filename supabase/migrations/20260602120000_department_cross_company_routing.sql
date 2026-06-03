-- =============================================================================
-- Roteamento de departamento entre empresas (cross-company routing)
-- =============================================================================
-- Problema de negocio:
--   Algumas empresas possuem lancamentos que, por departamento, deveriam compor
--   a DRE e o Fluxo de Caixa de OUTRA empresa. Ex.: na Terrazzo, todos os
--   lancamentos do departamento "Cubo Producoes" devem entrar na Feat Producoes.
--
-- Abordagem (roteamento VIRTUAL, em tempo de leitura):
--   O lancamento permanece gravado com seu company_id e department_code reais.
--   A coluna company_departments.routed_to_company_id define, por departamento
--   da empresa de ORIGEM, para qual empresa de DESTINO ele deve ser atribuido.
--   Todas as agregacoes passam a usar a "empresa efetiva":
--       effective_company_id = COALESCE(route.routed_to_company_id, fe.company_id)
--   Consequencias (alinhadas as decisoes do produto):
--     1) Um departamento roteia para UMA unica empresa.
--     2) O departamento roteado SOME 100% da DRE/Fluxo da origem (a empresa
--        efetiva passa a ser o destino, entao o filtro por empresa de origem
--        nao o captura mais).
--     3) Ele APARECE no destino, inclusive em consolidacoes de segmento
--        (contado uma unica vez, pela empresa efetiva — sem duplicar).
--
-- Mapeamento (Fase 1):
--   O lancamento roteado resolve categoria -> conta pelo mapeamento que JA
--   existe (escopo da origem ou global). Como o pipeline da DRE traduz a conta
--   pelo CODIGO (scopeDreAccounts/translateToScopedId), ela cai na conta de
--   mesmo codigo no plano do destino. Ou seja: basta ligar o roteamento e, na
--   maioria dos departamentos, ja funciona sem remapear nada. A camada de
--   override por departamento (mapeamento dedicado) fica para a Fase 2.
--
-- Seguranca / isolamento:
--   • As RPCs sao SECURITY INVOKER e o dashboard as chama com o client da
--     sessao (RLS ativo). Por isso adicionamos uma policy permissiva em
--     financial_entries: usuarios que enxergam a empresa de DESTINO podem ler
--     os lancamentos roteados para ela (senao sumiriam para perfis nao-admin).
--   • Sem nenhum departamento roteado (routed_to_company_id IS NULL em tudo),
--     o LEFT JOIN nao casa, effective_company_id = company_id, e o
--     comportamento de TODAS as empresas permanece identico ao atual.
--   • Nao altera dados da Omie, categorias nem mapeamento — apenas a LOGICA DE
--     LEITURA dos RPCs + uma coluna de configuracao.
-- =============================================================================

-- 1. Coluna de destino do roteamento no catalogo de departamentos da origem.
ALTER TABLE public.company_departments
  ADD COLUMN IF NOT EXISTS routed_to_company_id uuid REFERENCES public.companies(id);

-- Uma empresa nao pode rotear para si mesma.
ALTER TABLE public.company_departments
  DROP CONSTRAINT IF EXISTS company_departments_routed_not_self;
ALTER TABLE public.company_departments
  ADD CONSTRAINT company_departments_routed_not_self
  CHECK (routed_to_company_id IS NULL OR routed_to_company_id <> company_id);

-- Indice parcial para acelerar a checagem "este departamento roteia?".
CREATE INDEX IF NOT EXISTS company_departments_routed_idx
  ON public.company_departments(company_id, omie_code)
  WHERE routed_to_company_id IS NOT NULL;

-- 2. RLS: quem enxerga a empresa de DESTINO pode ler os lancamentos roteados
--    para ela (policy permissiva, OR-ed com as policies existentes).
DROP POLICY IF EXISTS "Read routed entries via destination access"
  ON public.financial_entries;
CREATE POLICY "Read routed entries via destination access"
  ON public.financial_entries
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.company_departments cd
      WHERE cd.company_id = financial_entries.company_id
        AND cd.omie_code = COALESCE(financial_entries.department_code, '__none__')
        AND cd.routed_to_company_id IS NOT NULL
        AND public.user_has_company_access(cd.routed_to_company_id)
    )
  );

-- =============================================================================
-- 3. RPCs da DRE recriadas com empresa efetiva.
--    Base: versoes vigentes (20260601130000 para aggregate/by_company,
--    20260601120000 para drilldown, 20260505120000 para consistency_check).
--    Unica mudanca: LEFT JOIN com o roteamento + filtro/agrupamento pela
--    empresa efetiva. O filtro de inclusao por departamento permanece keyed na
--    empresa de ORIGEM (fe.company_id) — departamentos roteados sao forcados a
--    included = true pela API, entao passam por ele e seguem para o destino.
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
    LEFT JOIN public.company_departments route
      ON route.company_id = fe.company_id
      AND route.omie_code = COALESCE(fe.department_code, '__none__')
      AND route.routed_to_company_id IS NOT NULL
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
      AND COALESCE(route.routed_to_company_id, fe.company_id) = ANY(p_company_ids)
      AND fe.category_code IS NOT NULL
      AND da.data_source = 'omie'
      AND NOT public.dre_entry_excluded_by_project(
            co.dre_exclude_linked_projects, fe.project_code, fe.project_name)
      AND (
        co.has_department_apportionment IS NOT TRUE
        OR EXISTS (
          SELECT 1
          FROM public.company_departments cd
          WHERE cd.company_id = fe.company_id
            AND cd.included = true
            AND cd.omie_code = COALESCE(fe.department_code, '__none__')
        )
      )
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
      COALESCE(route.routed_to_company_id, fe.company_id) AS company_id,
      mapping.dre_account_id,
      sum(fe.value)::numeric AS amount
    FROM public.financial_entries fe
    JOIN public.companies co ON co.id = fe.company_id
    LEFT JOIN public.company_departments route
      ON route.company_id = fe.company_id
      AND route.omie_code = COALESCE(fe.department_code, '__none__')
      AND route.routed_to_company_id IS NOT NULL
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
      AND COALESCE(route.routed_to_company_id, fe.company_id) = ANY(p_company_ids)
      AND fe.category_code IS NOT NULL
      AND da.data_source = 'omie'
      AND NOT public.dre_entry_excluded_by_project(
            co.dre_exclude_linked_projects, fe.project_code, fe.project_name)
      AND (
        co.has_department_apportionment IS NOT TRUE
        OR EXISTS (
          SELECT 1
          FROM public.company_departments cd
          WHERE cd.company_id = fe.company_id
            AND cd.included = true
            AND cd.omie_code = COALESCE(fe.department_code, '__none__')
        )
      )
    GROUP BY COALESCE(route.routed_to_company_id, fe.company_id), mapping.dre_account_id
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
    -- Exibe a empresa de ORIGEM real do lancamento (provenance): num drilldown
    -- da empresa de destino, as linhas roteadas aparecem com o nome da origem.
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
    LEFT JOIN public.company_departments route
      ON route.company_id = fe.company_id
      AND route.omie_code = COALESCE(fe.department_code, '__none__')
      AND route.routed_to_company_id IS NOT NULL
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
      AND COALESCE(route.routed_to_company_id, fe.company_id) = ANY(p_company_ids)
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

CREATE OR REPLACE FUNCTION public.dashboard_dre_consistency_check(
  p_company_ids uuid[],
  p_date_from date,
  p_date_to date
)
RETURNS TABLE (
  company_id uuid,
  company_name text,
  dre_account_id uuid,
  dre_account_code text,
  dre_account_name text,
  amount numeric,
  entry_count bigint,
  oldest_entry timestamptz,
  newest_entry timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH mapped AS (
    SELECT
      COALESCE(route.routed_to_company_id, fe.company_id) AS company_id,
      fe.value,
      fe.created_at,
      mapping.dre_account_id
    FROM public.financial_entries fe
    JOIN public.companies c ON c.id = fe.company_id
    LEFT JOIN public.company_departments route
      ON route.company_id = fe.company_id
      AND route.omie_code = COALESCE(fe.department_code, '__none__')
      AND route.routed_to_company_id IS NOT NULL
    CROSS JOIN LATERAL (
      SELECT cm.dre_account_id
      FROM public.category_mapping cm
      WHERE cm.omie_category_code = fe.category_code
        AND (cm.company_id = fe.company_id OR cm.company_id IS NULL)
      ORDER BY cm.company_id NULLS LAST
      LIMIT 1
    ) mapping
    WHERE fe.payment_date BETWEEN p_date_from AND p_date_to
      AND COALESCE(route.routed_to_company_id, fe.company_id) = ANY(p_company_ids)
      AND fe.category_code IS NOT NULL
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
  )
  SELECT
    m.company_id,
    c.name AS company_name,
    m.dre_account_id,
    a.code AS dre_account_code,
    a.name AS dre_account_name,
    sum(m.value)::numeric AS amount,
    count(*)::bigint AS entry_count,
    min(m.created_at) AS oldest_entry,
    max(m.created_at) AS newest_entry
  FROM mapped m
  JOIN public.companies c ON c.id = m.company_id
  JOIN public.dre_accounts a ON a.id = m.dre_account_id
  GROUP BY m.company_id, c.name, m.dre_account_id, a.code, a.name
  ORDER BY c.name, a.code;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_dre_consistency_check(uuid[], date, date) TO authenticated;

-- =============================================================================
-- 4. RPCs do Fluxo de Caixa recriadas com empresa efetiva.
--    Base: versao vigente 20260506170000 (match por categoria ORIGINAL,
--    removendo o prefixo sintetico '__fundos_(rec|desp)_'). Mesma logica de
--    roteamento da DRE.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cash_flow_aggregate(
  p_company_ids uuid[],
  p_date_from date,
  p_date_to date
)
RETURNS TABLE (
  cash_flow_account_id uuid,
  amount numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    mapping.cash_flow_account_id,
    sum(fe.value)::numeric AS amount
  FROM public.financial_entries fe
  JOIN public.companies c ON c.id = fe.company_id
  LEFT JOIN public.company_departments route
    ON route.company_id = fe.company_id
    AND route.omie_code = COALESCE(fe.department_code, '__none__')
    AND route.routed_to_company_id IS NOT NULL
  CROSS JOIN LATERAL (
    SELECT cm.cash_flow_account_id
    FROM public.cash_flow_category_mappings cm
    WHERE cm.omie_category_code = regexp_replace(fe.category_code, '^__fundos_(rec|desp)_', '')
      AND (cm.company_id = fe.company_id OR cm.company_id IS NULL)
    ORDER BY cm.company_id NULLS LAST
    LIMIT 1
  ) mapping
  WHERE fe.payment_date BETWEEN p_date_from AND p_date_to
    AND COALESCE(route.routed_to_company_id, fe.company_id) = ANY(p_company_ids)
    AND fe.category_code IS NOT NULL
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
  GROUP BY mapping.cash_flow_account_id;
$$;

GRANT EXECUTE ON FUNCTION public.cash_flow_aggregate(uuid[], date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.cash_flow_aggregate_by_company(
  p_company_ids uuid[],
  p_date_from date,
  p_date_to date
)
RETURNS TABLE (
  company_id uuid,
  cash_flow_account_id uuid,
  amount numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    COALESCE(route.routed_to_company_id, fe.company_id) AS company_id,
    mapping.cash_flow_account_id,
    sum(fe.value)::numeric AS amount
  FROM public.financial_entries fe
  JOIN public.companies c ON c.id = fe.company_id
  LEFT JOIN public.company_departments route
    ON route.company_id = fe.company_id
    AND route.omie_code = COALESCE(fe.department_code, '__none__')
    AND route.routed_to_company_id IS NOT NULL
  CROSS JOIN LATERAL (
    SELECT cm.cash_flow_account_id
    FROM public.cash_flow_category_mappings cm
    WHERE cm.omie_category_code = regexp_replace(fe.category_code, '^__fundos_(rec|desp)_', '')
      AND (cm.company_id = fe.company_id OR cm.company_id IS NULL)
    ORDER BY cm.company_id NULLS LAST
    LIMIT 1
  ) mapping
  WHERE fe.payment_date BETWEEN p_date_from AND p_date_to
    AND COALESCE(route.routed_to_company_id, fe.company_id) = ANY(p_company_ids)
    AND fe.category_code IS NOT NULL
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
  GROUP BY COALESCE(route.routed_to_company_id, fe.company_id), mapping.cash_flow_account_id;
$$;

GRANT EXECUTE ON FUNCTION public.cash_flow_aggregate_by_company(uuid[], date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.cash_flow_drilldown(
  p_cash_flow_account_id uuid,
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
  WITH base AS (
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
    LEFT JOIN public.company_departments route
      ON route.company_id = fe.company_id
      AND route.omie_code = COALESCE(fe.department_code, '__none__')
      AND route.routed_to_company_id IS NOT NULL
    CROSS JOIN LATERAL (
      SELECT cm.cash_flow_account_id
      FROM public.cash_flow_category_mappings cm
      WHERE cm.omie_category_code = regexp_replace(fe.category_code, '^__fundos_(rec|desp)_', '')
        AND (cm.company_id = fe.company_id OR cm.company_id IS NULL)
      ORDER BY cm.company_id NULLS LAST
      LIMIT 1
    ) mapping
    WHERE fe.payment_date BETWEEN p_date_from AND p_date_to
      AND COALESCE(route.routed_to_company_id, fe.company_id) = ANY(p_company_ids)
      AND mapping.cash_flow_account_id = p_cash_flow_account_id
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

GRANT EXECUTE ON FUNCTION public.cash_flow_drilldown(uuid, uuid[], date, date, text, integer, integer) TO authenticated;
