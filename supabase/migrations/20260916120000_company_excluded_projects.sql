-- =============================================================================
-- Projetos desconsiderados por empresa (DRE + Fluxo de Caixa)
-- =============================================================================
--
-- O QUE: tabela `company_excluded_projects` — por empresa, os projetos da Omie
-- (cCodProjeto) cujos lancamentos NAO entram em nenhum numero do Financeiro:
-- DRE, Fluxo de Caixa, Previsto x Realizado, Comparativos, BI e drilldowns.
-- Se o projeto nao esta na lista, e considerado normalmente.
--
-- CASO DE ORIGEM: Village, projeto "APT 402 MACHADO SOBRINHO" (11508080761),
-- que nunca deve entrar no resultado da empresa.
--
-- COMO: um predicado novo, `entry_excluded_by_company_project(company, projeto)`,
-- acrescentado como `AND NOT ...` no ramo que le financial_entries das 7 funcoes
-- abaixo. E aditivo: com a tabela vazia, `NOT EXISTS` e sempre verdadeiro e a
-- saida de toda funcao e IDENTICA a de hoje, para toda empresa. A regra da Feat
-- Producoes (`dre_entry_excluded_by_project`, flag `dre_exclude_linked_projects`)
-- nao e alterada nem passa a valer no Fluxo — continua exatamente como esta.
--
-- A lista e da empresa de ORIGEM do lancamento (fe.company_id): o codigo de
-- projeto so tem significado na Omie daquela empresa. Vale mesmo quando o
-- lancamento e roteado por departamento para outra empresa.
--
-- Os lancamentos nunca saem de financial_entries: so deixam de ser somados.
-- Desmarcar o projeto e rodar o refresh dos agregados da empresa os traz de
-- volta — sem re-sync.
--
-- FUNCOES RECRIADAS (copia da versao vigente + a unica linha nova):

--   refresh_dre_monthly_aggregates           base: 20260618150000_routed_entries_skip_origin_project_rule.sql
--   dashboard_dre_aggregate_live             base: 20260618150000_routed_entries_skip_origin_project_rule.sql
--   dashboard_dre_drilldown                  base: 20260724140000_manual_entries_observation_drilldown.sql
--   refresh_cash_flow_monthly_aggregates     base: 20260605130000_cash_flow_monthly_aggregates.sql
--   cash_flow_aggregate_live                 base: 20260605130000_cash_flow_monthly_aggregates.sql
--   cash_flow_drilldown                      base: 20260602150000_routed_mapping_multi_tier.sql
--   cash_flow_aggregate_by_registration      base: 20260622120000_cash_flow_aggregate_by_registration.sql
--
-- NAO recriada de proposito: dashboard_dre_consistency_check (nenhum caller no
-- app; nem a regra da Feat ela recebeu). Funcoes de parceiros (Franquias Viva)
-- e do Orcamento de Compras tambem leem financial_entries e ficam como estao —
-- fora do escopo "Financeiro" deste pedido.
--
-- SEGURANCA: refresh_* sao SECURITY DEFINER. Recriar reabre EXECUTE para
-- anon/authenticated (default privileges do projeto) — por isso o REVOKE/GRANT e
-- o statement_timeout sao reaplicados no fim, como fez 20260903120000.
-- =============================================================================

-- 1) Tabela --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.company_excluded_projects (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- cCodProjeto da Omie, como vem em financial_entries.project_code.
  omie_project_code text NOT NULL,
  -- Nome no momento do cadastro, so para leitura humana (o projeto pode ser
  -- renomeado na Omie; a chave e o codigo).
  omie_project_name text,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (company_id, omie_project_code)
);

CREATE INDEX IF NOT EXISTS company_excluded_projects_company_idx
  ON public.company_excluded_projects (company_id);

ALTER TABLE public.company_excluded_projects ENABLE ROW LEVEL SECURITY;

-- Leitura: mesmo vinculo das demais tabelas empresa-escopadas — ja no modelo
-- novo (user_has_company_access), nao no legado users.company_id.
DROP POLICY IF EXISTS "Read company_excluded_projects by access" ON public.company_excluded_projects;
CREATE POLICY "Read company_excluded_projects by access"
  ON public.company_excluded_projects FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.is_hero_manager()
    OR public.user_has_company_access(company_id)
  );

DROP POLICY IF EXISTS "Write company_excluded_projects admin" ON public.company_excluded_projects;
CREATE POLICY "Write company_excluded_projects admin"
  ON public.company_excluded_projects FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 2) Predicado -----------------------------------------------------------------
--
-- SECURITY DEFINER de proposito: e chamado dentro de funcoes SECURITY INVOKER
-- (drilldowns, _live) executadas pelo usuario final. Se a consulta a tabela
-- ficasse sujeita a RLS do usuario, um usuario sem vinculo com a empresa de
-- ORIGEM de um lancamento roteado veria o lancamento excluido para o admin e
-- incluido para ele — o mesmo tipo de divergencia silenciosa da RLS das tabelas
-- manuais (20260908120000). O predicado so devolve um booleano sobre um par
-- (empresa, codigo de projeto); nao expoe dado financeiro. Mesmo enquadramento
-- de user_has_company_access(): predicado liberado para authenticated.

CREATE OR REPLACE FUNCTION public.entry_excluded_by_company_project(
  p_company_id uuid,
  p_project_code text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_project_code IS NOT NULL
    AND btrim(p_project_code) <> ''
    AND EXISTS (
      SELECT 1
      FROM public.company_excluded_projects x
      WHERE x.company_id = p_company_id
        AND x.omie_project_code = btrim(p_project_code)
    );
$$;

REVOKE EXECUTE ON FUNCTION public.entry_excluded_by_company_project(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.entry_excluded_by_company_project(uuid, text) TO authenticated, service_role;

-- 3) Funcoes recriadas ----------------------------------------------------------


-- refresh_dre_monthly_aggregates (base: 20260618150000_routed_entries_skip_origin_project_rule.sql) ---------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_dre_monthly_aggregates(
  p_company_ids uuid[] DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.dre_monthly_aggregates
  WHERE p_company_ids IS NULL OR company_id = ANY(p_company_ids);

  INSERT INTO public.dre_monthly_aggregates (company_id, dre_account_id, year, month, amount)
  SELECT
    COALESCE(route.routed_to_company_id, fe.company_id) AS company_id,
    mapping.dre_account_id,
    EXTRACT(YEAR FROM fe.payment_date)::int AS year,
    EXTRACT(MONTH FROM fe.payment_date)::int AS month,
    sum(fe.value)::numeric AS amount
  FROM public.financial_entries fe
  JOIN public.companies co ON co.id = fe.company_id
  LEFT JOIN public.company_departments route
    ON route.company_id = fe.company_id
    AND route.omie_code = COALESCE(fe.department_code, '__none__')
    AND route.routed_to_company_id IS NOT NULL
  CROSS JOIN LATERAL (
    SELECT m.dre_account_id
    FROM (
      SELECT rcm.dre_account_id, 0 AS prio, 0 AS subrank
      FROM public.routed_category_mapping rcm
      WHERE route.routed_to_company_id IS NOT NULL
        AND rcm.target_company_id = route.routed_to_company_id
        AND rcm.source_company_id = fe.company_id
        AND rcm.omie_department_code = COALESCE(fe.department_code, '__none__')
        AND rcm.omie_category_code = fe.category_code
      UNION ALL
      SELECT cm.dre_account_id, 1 AS prio,
        CASE
          WHEN cm.company_id = COALESCE(route.routed_to_company_id, fe.company_id) THEN 0
          WHEN cm.company_id = fe.company_id THEN 1
          ELSE 2
        END AS subrank
      FROM public.category_mapping cm
      WHERE cm.omie_category_code = fe.category_code
        AND (cm.company_id = COALESCE(route.routed_to_company_id, fe.company_id)
             OR cm.company_id = fe.company_id
             OR cm.company_id IS NULL)
    ) m
    ORDER BY m.prio, m.subrank
    LIMIT 1
  ) mapping
  JOIN public.dre_accounts da ON da.id = mapping.dre_account_id
  WHERE fe.category_code IS NOT NULL
    AND NOT public.entry_excluded_by_company_project(fe.company_id, fe.project_code)
    AND (
      da.data_source = 'omie'
      OR (da.data_source = 'sheets'
          AND COALESCE(co.dre_sum_sheets_with_omie, false))
    )
    AND (p_company_ids IS NULL
         OR COALESCE(route.routed_to_company_id, fe.company_id) = ANY(p_company_ids))
    -- Regra de projeto da ORIGEM so vale para lancamentos que PERMANECEM nela.
    -- Lancamentos roteados (effective != origem) ignoram o gate da origem.
    AND (
      route.routed_to_company_id IS NOT NULL
      OR NOT public.dre_entry_excluded_by_project(
           co.dre_exclude_linked_projects, fe.project_code, fe.project_name)
    )
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
  GROUP BY 1, 2, 3, 4;
END;
$$;

-- dashboard_dre_aggregate_live (base: 20260618150000_routed_entries_skip_origin_project_rule.sql) ---------------------------------------
CREATE OR REPLACE FUNCTION public.dashboard_dre_aggregate_live(
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
      SELECT m.dre_account_id
      FROM (
        SELECT rcm.dre_account_id, 0 AS prio, 0 AS subrank
        FROM public.routed_category_mapping rcm
        WHERE route.routed_to_company_id IS NOT NULL
          AND rcm.target_company_id = route.routed_to_company_id
          AND rcm.source_company_id = fe.company_id
          AND rcm.omie_department_code = COALESCE(fe.department_code, '__none__')
          AND rcm.omie_category_code = fe.category_code
        UNION ALL
        SELECT cm.dre_account_id, 1 AS prio,
          CASE
            WHEN cm.company_id = COALESCE(route.routed_to_company_id, fe.company_id) THEN 0
            WHEN cm.company_id = fe.company_id THEN 1
            ELSE 2
          END AS subrank
        FROM public.category_mapping cm
        WHERE cm.omie_category_code = fe.category_code
          AND (cm.company_id = COALESCE(route.routed_to_company_id, fe.company_id)
               OR cm.company_id = fe.company_id
               OR cm.company_id IS NULL)
      ) m
      ORDER BY m.prio, m.subrank
      LIMIT 1
    ) mapping
    JOIN public.dre_accounts da ON da.id = mapping.dre_account_id
    WHERE fe.payment_date BETWEEN p_date_from AND p_date_to
      AND NOT public.entry_excluded_by_company_project(fe.company_id, fe.project_code)
      AND COALESCE(route.routed_to_company_id, fe.company_id) = ANY(p_company_ids)
      AND fe.category_code IS NOT NULL
      AND (
        da.data_source = 'omie'
        OR (da.data_source = 'sheets'
            AND COALESCE(co.dre_sum_sheets_with_omie, false))
      )
      AND (
        route.routed_to_company_id IS NOT NULL
        OR NOT public.dre_entry_excluded_by_project(
             co.dre_exclude_linked_projects, fe.project_code, fe.project_name)
      )
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
  ),
  manual_entry_amounts AS (
    SELECT
      mapping.dre_account_id,
      sum(me.value)::numeric AS amount
    FROM public.manual_entries me
    CROSS JOIN LATERAL (
      SELECT cm.dre_account_id
      FROM public.category_mapping cm
      WHERE cm.omie_category_code = me.category_code
        AND (cm.company_id = me.company_id OR cm.company_id IS NULL)
      ORDER BY CASE WHEN cm.company_id = me.company_id THEN 0 ELSE 1 END
      LIMIT 1
    ) mapping
    JOIN public.dre_accounts da ON da.id = mapping.dre_account_id
    WHERE me.company_id = ANY(p_company_ids)
      AND me.entry_date BETWEEN p_date_from AND p_date_to
      AND da.data_source = 'omie'
    GROUP BY mapping.dre_account_id
  )
  SELECT dre_account_id, sum(amount)::numeric AS amount
  FROM (
    SELECT * FROM omie_amounts
    UNION ALL
    SELECT * FROM manual_amounts
    UNION ALL
    SELECT * FROM manual_entry_amounts
  ) combined
  GROUP BY dre_account_id;
$$;

-- dashboard_dre_drilldown (base: 20260724140000_manual_entries_observation_drilldown.sql) ---------------------------------------
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
    -- Lançamentos da Omie (financial_entries), com roteamento de departamento.
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
      SELECT m.dre_account_id
      FROM (
        SELECT rcm.dre_account_id, 0 AS prio, 0 AS subrank
        FROM public.routed_category_mapping rcm
        WHERE route.routed_to_company_id IS NOT NULL
          AND rcm.target_company_id = route.routed_to_company_id
          AND rcm.source_company_id = fe.company_id
          AND rcm.omie_department_code = COALESCE(fe.department_code, '__none__')
          AND rcm.omie_category_code = fe.category_code
        UNION ALL
        SELECT cm.dre_account_id, 1 AS prio,
          CASE WHEN cm.company_id IS NOT NULL THEN 0 ELSE 1 END AS subrank
        FROM public.category_mapping cm
        WHERE cm.omie_category_code = fe.category_code
          AND (cm.company_id = COALESCE(route.routed_to_company_id, fe.company_id)
               OR cm.company_id IS NULL)
      ) m
      ORDER BY m.prio, m.subrank
      LIMIT 1
    ) mapping
    JOIN public.dre_accounts resolved ON resolved.id = mapping.dre_account_id
    WHERE fe.payment_date BETWEEN p_date_from AND p_date_to
      AND NOT public.entry_excluded_by_company_project(fe.company_id, fe.project_code)
      AND COALESCE(route.routed_to_company_id, fe.company_id) = ANY(p_company_ids)
      AND resolved.code = (SELECT code FROM target)
      AND (
        route.routed_to_company_id IS NOT NULL
        OR NOT public.dre_entry_excluded_by_project(
             c.dre_exclude_linked_projects, fe.project_code, fe.project_name)
      )
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
    UNION ALL
    -- Lançamentos manuais (manual_entries), resolvidos pelo mesmo
    -- category_mapping. Descrição = Observação quando preenchida, senão categoria.
    SELECT
      me.id AS financial_entry_id,
      me.entry_date AS payment_date,
      COALESCE(NULLIF(btrim(me.observation), ''), me.category_name) AS description,
      NULL::text AS supplier_customer,
      NULL::text AS document_number,
      me.value,
      me.company_id,
      c2.name AS company_name
    FROM public.manual_entries me
    JOIN public.companies c2 ON c2.id = me.company_id
    CROSS JOIN LATERAL (
      SELECT cm.dre_account_id
      FROM public.category_mapping cm
      WHERE cm.omie_category_code = me.category_code
        AND (cm.company_id = me.company_id OR cm.company_id IS NULL)
      ORDER BY CASE WHEN cm.company_id = me.company_id THEN 0 ELSE 1 END
      LIMIT 1
    ) mapping
    JOIN public.dre_accounts resolved ON resolved.id = mapping.dre_account_id
    WHERE me.entry_date BETWEEN p_date_from AND p_date_to
      AND me.company_id = ANY(p_company_ids)
      AND resolved.code = (SELECT code FROM target)
      AND (
        p_search IS NULL
        OR p_search = ''
        OR me.category_name ILIKE '%' || p_search || '%'
        OR COALESCE(me.observation, '') ILIKE '%' || p_search || '%'
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

-- refresh_cash_flow_monthly_aggregates (base: 20260605130000_cash_flow_monthly_aggregates.sql) ---------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_cash_flow_monthly_aggregates(
  p_company_ids uuid[] DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.cash_flow_monthly_aggregates
  WHERE p_company_ids IS NULL OR company_id = ANY(p_company_ids);

  INSERT INTO public.cash_flow_monthly_aggregates (company_id, cash_flow_account_id, year, month, amount)
  SELECT
    COALESCE(route.routed_to_company_id, fe.company_id) AS company_id,
    mapping.cash_flow_account_id,
    EXTRACT(YEAR FROM fe.payment_date)::int AS year,
    EXTRACT(MONTH FROM fe.payment_date)::int AS month,
    sum(fe.value)::numeric AS amount
  FROM public.financial_entries fe
  JOIN public.companies c ON c.id = fe.company_id
  LEFT JOIN public.company_departments route
    ON route.company_id = fe.company_id
    AND route.omie_code = COALESCE(fe.department_code, '__none__')
    AND route.routed_to_company_id IS NOT NULL
  CROSS JOIN LATERAL (
    SELECT m.cash_flow_account_id
    FROM (
      SELECT rcm.cash_flow_account_id, 0 AS prio, 0 AS subrank
      FROM public.routed_cash_flow_category_mapping rcm
      WHERE route.routed_to_company_id IS NOT NULL
        AND rcm.target_company_id = route.routed_to_company_id
        AND rcm.source_company_id = fe.company_id
        AND rcm.omie_department_code = COALESCE(fe.department_code, '__none__')
        AND rcm.omie_category_code = regexp_replace(fe.category_code, '^__fundos_(rec|desp)_', '')
      UNION ALL
      SELECT cm.cash_flow_account_id, 1 AS prio,
        CASE
          WHEN cm.company_id = COALESCE(route.routed_to_company_id, fe.company_id) THEN 0
          WHEN cm.company_id = fe.company_id THEN 1
          ELSE 2
        END AS subrank
      FROM public.cash_flow_category_mappings cm
      WHERE cm.omie_category_code = regexp_replace(fe.category_code, '^__fundos_(rec|desp)_', '')
        AND (cm.company_id = COALESCE(route.routed_to_company_id, fe.company_id)
             OR cm.company_id = fe.company_id
             OR cm.company_id IS NULL)
    ) m
    ORDER BY m.prio, m.subrank
    LIMIT 1
  ) mapping
  WHERE fe.category_code IS NOT NULL
    AND NOT public.entry_excluded_by_company_project(fe.company_id, fe.project_code)
    AND (p_company_ids IS NULL
         OR COALESCE(route.routed_to_company_id, fe.company_id) = ANY(p_company_ids))
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
  GROUP BY 1, 2, 3, 4;
END;
$$;

-- cash_flow_aggregate_live (base: 20260605130000_cash_flow_monthly_aggregates.sql) ---------------------------------------
CREATE OR REPLACE FUNCTION public.cash_flow_aggregate_live(
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
    SELECT m.cash_flow_account_id
    FROM (
      SELECT rcm.cash_flow_account_id, 0 AS prio, 0 AS subrank
      FROM public.routed_cash_flow_category_mapping rcm
      WHERE route.routed_to_company_id IS NOT NULL
        AND rcm.target_company_id = route.routed_to_company_id
        AND rcm.source_company_id = fe.company_id
        AND rcm.omie_department_code = COALESCE(fe.department_code, '__none__')
        AND rcm.omie_category_code = regexp_replace(fe.category_code, '^__fundos_(rec|desp)_', '')
      UNION ALL
      SELECT cm.cash_flow_account_id, 1 AS prio,
        CASE
          WHEN cm.company_id = COALESCE(route.routed_to_company_id, fe.company_id) THEN 0
          WHEN cm.company_id = fe.company_id THEN 1
          ELSE 2
        END AS subrank
      FROM public.cash_flow_category_mappings cm
      WHERE cm.omie_category_code = regexp_replace(fe.category_code, '^__fundos_(rec|desp)_', '')
        AND (cm.company_id = COALESCE(route.routed_to_company_id, fe.company_id)
             OR cm.company_id = fe.company_id
             OR cm.company_id IS NULL)
    ) m
    ORDER BY m.prio, m.subrank
    LIMIT 1
  ) mapping
  WHERE fe.payment_date BETWEEN p_date_from AND p_date_to
    AND NOT public.entry_excluded_by_company_project(fe.company_id, fe.project_code)
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

-- cash_flow_drilldown (base: 20260602150000_routed_mapping_multi_tier.sql) ---------------------------------------
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
      SELECT m.cash_flow_account_id
      FROM (
        SELECT rcm.cash_flow_account_id, 0 AS prio, 0 AS subrank
        FROM public.routed_cash_flow_category_mapping rcm
        WHERE route.routed_to_company_id IS NOT NULL
          AND rcm.target_company_id = route.routed_to_company_id
          AND rcm.source_company_id = fe.company_id
          AND rcm.omie_department_code = COALESCE(fe.department_code, '__none__')
          AND rcm.omie_category_code = regexp_replace(fe.category_code, '^__fundos_(rec|desp)_', '')
        UNION ALL
        SELECT cm.cash_flow_account_id, 1 AS prio,
          CASE
            WHEN cm.company_id = COALESCE(route.routed_to_company_id, fe.company_id) THEN 0
            WHEN cm.company_id = fe.company_id THEN 1
            ELSE 2
          END AS subrank
        FROM public.cash_flow_category_mappings cm
        WHERE cm.omie_category_code = regexp_replace(fe.category_code, '^__fundos_(rec|desp)_', '')
          AND (cm.company_id = COALESCE(route.routed_to_company_id, fe.company_id)
               OR cm.company_id = fe.company_id
               OR cm.company_id IS NULL)
      ) m
      ORDER BY m.prio, m.subrank
      LIMIT 1
    ) mapping
    WHERE fe.payment_date BETWEEN p_date_from AND p_date_to
      AND NOT public.entry_excluded_by_company_project(fe.company_id, fe.project_code)
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

-- cash_flow_aggregate_by_registration (base: 20260622120000_cash_flow_aggregate_by_registration.sql) ---------------------------------------
CREATE OR REPLACE FUNCTION public.cash_flow_aggregate_by_registration(
  p_company_ids uuid[],
  p_date_from date,
  p_date_to date,
  p_category_codes text[]
)
RETURNS TABLE (
  period_year integer,
  period_month integer,
  cash_flow_account_id uuid,
  amount numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH candidate AS (
    -- Pré-filtro barato: empresa + categoria da Custódia. Só aqui extraímos a
    -- data de registro do raw_json (caro), num conjunto já pequeno.
    SELECT
      fe.value AS value,
      fe.company_id AS company_id,
      fe.category_code AS category_code,
      fe.department_code AS department_code,
      CASE
        WHEN COALESCE(fe.raw_json->'detalhes'->>'dDtInc', fe.raw_json->>'dDtInc')
             ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
        THEN to_date(
          COALESCE(fe.raw_json->'detalhes'->>'dDtInc', fe.raw_json->>'dDtInc'),
          'DD/MM/YYYY')
        ELSE NULL
      END AS registro_date
    FROM public.financial_entries fe
    WHERE fe.company_id = ANY(p_company_ids)
      AND NOT public.entry_excluded_by_company_project(fe.company_id, fe.project_code)
      AND fe.category_code IS NOT NULL
      AND regexp_replace(fe.category_code, '^__fundos_(rec|desp)_', '') = ANY(p_category_codes)
  ),
  filtered AS (
    SELECT * FROM candidate
    WHERE registro_date IS NOT NULL
      AND registro_date BETWEEN p_date_from AND p_date_to
  )
  SELECT
    EXTRACT(YEAR FROM fe.registro_date)::int AS period_year,
    EXTRACT(MONTH FROM fe.registro_date)::int AS period_month,
    mapping.cash_flow_account_id,
    sum(fe.value)::numeric AS amount
  FROM filtered fe
  JOIN public.companies c ON c.id = fe.company_id
  LEFT JOIN public.company_departments route
    ON route.company_id = fe.company_id
    AND route.omie_code = COALESCE(fe.department_code, '__none__')
    AND route.routed_to_company_id IS NOT NULL
  CROSS JOIN LATERAL (
    SELECT m.cash_flow_account_id
    FROM (
      SELECT rcm.cash_flow_account_id, 0 AS prio, 0 AS subrank
      FROM public.routed_cash_flow_category_mapping rcm
      WHERE route.routed_to_company_id IS NOT NULL
        AND rcm.target_company_id = route.routed_to_company_id
        AND rcm.source_company_id = fe.company_id
        AND rcm.omie_department_code = COALESCE(fe.department_code, '__none__')
        AND rcm.omie_category_code = regexp_replace(fe.category_code, '^__fundos_(rec|desp)_', '')
      UNION ALL
      SELECT cm.cash_flow_account_id, 1 AS prio,
        CASE
          WHEN cm.company_id = COALESCE(route.routed_to_company_id, fe.company_id) THEN 0
          WHEN cm.company_id = fe.company_id THEN 1
          ELSE 2
        END AS subrank
      FROM public.cash_flow_category_mappings cm
      WHERE cm.omie_category_code = regexp_replace(fe.category_code, '^__fundos_(rec|desp)_', '')
        AND (cm.company_id = COALESCE(route.routed_to_company_id, fe.company_id)
             OR cm.company_id = fe.company_id
             OR cm.company_id IS NULL)
    ) m
    ORDER BY m.prio, m.subrank
    LIMIT 1
  ) mapping
  WHERE COALESCE(route.routed_to_company_id, fe.company_id) = ANY(p_company_ids)
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
  GROUP BY 1, 2, mapping.cash_flow_account_id;
$$;

-- 4) Privilegios e timeouts reaplicados ----------------------------------------
--    (a recriacao acima zera o que 20260903120000 e 20260609180000 fizeram)

REVOKE EXECUTE ON FUNCTION public.refresh_dre_monthly_aggregates(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.refresh_dre_monthly_aggregates(uuid[]) TO service_role;
ALTER FUNCTION public.refresh_dre_monthly_aggregates(uuid[]) SET statement_timeout = '180s';

REVOKE EXECUTE ON FUNCTION public.refresh_cash_flow_monthly_aggregates(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.refresh_cash_flow_monthly_aggregates(uuid[]) TO service_role;
ALTER FUNCTION public.refresh_cash_flow_monthly_aggregates(uuid[]) SET statement_timeout = '180s';

GRANT EXECUTE ON FUNCTION public.dashboard_dre_aggregate_live(uuid[], date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_dre_drilldown(uuid, uuid[], date, date, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cash_flow_aggregate_live(uuid[], date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cash_flow_drilldown(uuid, uuid[], date, date, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cash_flow_aggregate_by_registration(uuid[], date, date, text[]) TO authenticated;
