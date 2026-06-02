-- =============================================================================
-- FIX do roteamento: lancamento roteado usa o mapeamento da empresa de DESTINO.
-- =============================================================================
-- Sintoma:
--   Lancamentos de um departamento roteado (ex.: Cubo da Terrazzo -> Feat) NAO
--   apareciam na DRE/Fluxo do destino — so os lancamentos nativos do destino.
--
-- Causa raiz:
--   Na Fase 1/2 (20260602120000/130000) o resolvedor de categoria -> conta
--   procurava mapeamento com `cm.company_id = fe.company_id` (empresa de
--   ORIGEM) OR global. Mas o mapeamento da categoria (ex.: "Salarios") esta
--   cadastrado na empresa de DESTINO (company-scoped). Como a busca usava a
--   origem, o mapeamento do destino era ignorado; sem mapeamento na origem nem
--   global, o CROSS JOIN LATERAL descartava a linha.
--
-- Correcao:
--   O lancamento roteado deve ser mapeado COMO SE fosse do destino. Trocamos,
--   apenas no resolvedor de mapeamento, `fe.company_id` pela EMPRESA EFETIVA
--   `COALESCE(route.routed_to_company_id, fe.company_id)`. Assim:
--     - lancamento nao roteado: efetiva = company_id -> comportamento IDENTICO.
--     - lancamento roteado: usa o mapeamento (company-scoped) do destino, com
--       fallback para global. O override roteado continua tendo prioridade.
--
--   Prioridade final: override roteado > mapeamento da empresa efetiva
--   (destino) > global.
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
        CASE WHEN cm.company_id IS NOT NULL THEN 0 ELSE 1 END AS subrank
      FROM public.cash_flow_category_mappings cm
      WHERE cm.omie_category_code = regexp_replace(fe.category_code, '^__fundos_(rec|desp)_', '')
        AND (cm.company_id = COALESCE(route.routed_to_company_id, fe.company_id)
             OR cm.company_id IS NULL)
    ) m
    ORDER BY m.prio, m.subrank
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
        CASE WHEN cm.company_id IS NOT NULL THEN 0 ELSE 1 END AS subrank
      FROM public.cash_flow_category_mappings cm
      WHERE cm.omie_category_code = regexp_replace(fe.category_code, '^__fundos_(rec|desp)_', '')
        AND (cm.company_id = COALESCE(route.routed_to_company_id, fe.company_id)
             OR cm.company_id IS NULL)
    ) m
    ORDER BY m.prio, m.subrank
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
          CASE WHEN cm.company_id IS NOT NULL THEN 0 ELSE 1 END AS subrank
        FROM public.cash_flow_category_mappings cm
        WHERE cm.omie_category_code = regexp_replace(fe.category_code, '^__fundos_(rec|desp)_', '')
          AND (cm.company_id = COALESCE(route.routed_to_company_id, fe.company_id)
               OR cm.company_id IS NULL)
      ) m
      ORDER BY m.prio, m.subrank
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
