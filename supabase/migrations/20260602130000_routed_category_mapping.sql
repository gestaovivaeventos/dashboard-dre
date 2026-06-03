-- =============================================================================
-- Fase 2 do roteamento de departamento entre empresas: OVERRIDE de mapeamento.
-- =============================================================================
-- Contexto (ver 20260602120000_department_cross_company_routing.sql):
--   Na Fase 1, um departamento roteado (ex.: "Cubo Producoes" da Terrazzo ->
--   Feat) ja compoe a DRE/Fluxo do destino, resolvendo categoria -> conta pelo
--   mapeamento que JA existe (origem/global) e caindo na conta de mesmo CODIGO
--   no plano do destino.
--
-- Esta migration adiciona uma camada de OVERRIDE opcional, por (empresa
-- destino, empresa origem, departamento, categoria), para os casos em que o
-- usuario quer que uma categoria daquele departamento caia numa conta
-- DIFERENTE da resolvida automaticamente. E o que alimenta a secao
-- "Mapeamento do departamento XX da empresa YY" na tela de mapeamento do
-- destino (DRE e Fluxo de Caixa).
--
-- Prioridade de resolucao nas RPCs:
--   1) override roteado (routed_category_mapping / routed_cash_flow_...)
--   2) mapeamento da empresa (company-scoped)
--   3) mapeamento global
--   (2 e 3 mantem a ordem atual via NULLS LAST -> subrank)
--
-- Para lancamentos NAO roteados (route.routed_to_company_id IS NULL) o ramo de
-- override nao casa e a resolucao fica IDENTICA ao comportamento atual.
--
-- A conta gravada no override e sempre uma conta do plano do DESTINO (o id que
-- o usuario escolhe no dropdown). O pipeline do dashboard traduz id -> codigo
-- -> id no escopo exibido (scopeDreAccounts/translateToScopedId), entao funciona
-- tanto na visao isolada do destino quanto em consolidacoes.
-- =============================================================================

-- 1. Tabelas de override -------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.routed_category_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  source_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  omie_department_code text NOT NULL,
  omie_category_code text NOT NULL,
  omie_category_name text,
  dre_account_id uuid NOT NULL REFERENCES public.dre_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS routed_category_mapping_unique_idx
  ON public.routed_category_mapping(
    target_company_id, source_company_id, omie_department_code, omie_category_code
  );

CREATE INDEX IF NOT EXISTS routed_category_mapping_lookup_idx
  ON public.routed_category_mapping(
    source_company_id, omie_department_code, omie_category_code
  );

CREATE TABLE IF NOT EXISTS public.routed_cash_flow_category_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  source_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  omie_department_code text NOT NULL,
  omie_category_code text NOT NULL,
  omie_category_name text,
  cash_flow_account_id uuid NOT NULL REFERENCES public.cash_flow_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS routed_cash_flow_category_mapping_unique_idx
  ON public.routed_cash_flow_category_mapping(
    target_company_id, source_company_id, omie_department_code, omie_category_code
  );

CREATE INDEX IF NOT EXISTS routed_cash_flow_category_mapping_lookup_idx
  ON public.routed_cash_flow_category_mapping(
    source_company_id, omie_department_code, omie_category_code
  );

-- 2. RLS: leitura para qualquer autenticado (o dashboard le sob SECURITY
--    INVOKER para todos os perfis; sao apenas config de mapeamento, sem valores
--    financeiros — mesmo padrao de cash_flow_accounts). Escrita so admin.
ALTER TABLE public.routed_category_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routed_cash_flow_category_mapping ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read routed_category_mapping authenticated"
  ON public.routed_category_mapping;
CREATE POLICY "Read routed_category_mapping authenticated"
  ON public.routed_category_mapping FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Write routed_category_mapping admin"
  ON public.routed_category_mapping;
CREATE POLICY "Write routed_category_mapping admin"
  ON public.routed_category_mapping FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Read routed_cash_flow_category_mapping authenticated"
  ON public.routed_cash_flow_category_mapping;
CREATE POLICY "Read routed_cash_flow_category_mapping authenticated"
  ON public.routed_cash_flow_category_mapping FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Write routed_cash_flow_category_mapping admin"
  ON public.routed_cash_flow_category_mapping;
CREATE POLICY "Write routed_cash_flow_category_mapping admin"
  ON public.routed_cash_flow_category_mapping FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 3. RPC: categorias efetivamente usadas por (empresa origem, departamento).
--    Alimenta a tela de override do destino. Exclui codigos sinteticos
--    '__fundos_*' (como a tela de mapeamento principal ja faz).
CREATE OR REPLACE FUNCTION public.routed_department_categories(
  p_source_company_id uuid,
  p_department_code text
)
RETURNS TABLE (category_code text, category_name text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT fe.category_code, max(fe.category_name) AS category_name
  FROM public.financial_entries fe
  WHERE fe.company_id = p_source_company_id
    AND COALESCE(fe.department_code, '__none__') = p_department_code
    AND fe.category_code IS NOT NULL
    AND NOT starts_with(fe.category_code, '__fundos_')
  GROUP BY fe.category_code
  ORDER BY fe.category_code;
$$;

GRANT EXECUTE ON FUNCTION public.routed_department_categories(uuid, text) TO authenticated;

-- =============================================================================
-- 4. Recriacao das 7 RPCs com a camada de override no resolvedor de conta.
--    Base: versoes da Fase 1 (20260602120000). Unica mudanca: o CROSS JOIN
--    LATERAL passa a considerar override roteado com prioridade.
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
          AND (cm.company_id = fe.company_id OR cm.company_id IS NULL)
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
          AND (cm.company_id = fe.company_id OR cm.company_id IS NULL)
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
          AND (cm.company_id = fe.company_id OR cm.company_id IS NULL)
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
          AND (cm.company_id = fe.company_id OR cm.company_id IS NULL)
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
        AND (cm.company_id = fe.company_id OR cm.company_id IS NULL)
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
        AND (cm.company_id = fe.company_id OR cm.company_id IS NULL)
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
          AND (cm.company_id = fe.company_id OR cm.company_id IS NULL)
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
