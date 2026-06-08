-- =============================================================================
-- manual_entries — Lancamentos manuais (Categoria, Data, Valor) por empresa
-- =============================================================================
-- Caso de uso: empresa Village (segmento real-estate) mantem a mao uma tabela
-- de (Categoria DRE, Data, Valor) que NAO vem da Omie. Diferente do mecanismo
-- `manual_account_values` (Feat/Sheets, que joga o valor direto na conta DRE),
-- aqui as categorias passam pelo MESMO mapeamento das categorias Omie
-- (`category_mapping`), e o valor cai na conta DRE resolvida pelo mapa.
--
-- Storage DEDICADO (e nao financial_entries) porque o sync da Omie faz
-- upsert + cleanup_obsolete_entries por periodo e apagaria os lancamentos
-- manuais. As 3 RPCs do DRE (aggregate, aggregate_by_company, drilldown) sao
-- recriadas a partir da versao 20260602150000 (preservando todo o roteamento
-- de departamento) somando tambem esta fonte. As categorias manuais sao texto
-- e os codigos Omie sao numericos, entao nao ha colisao com as CTEs Omie.
-- =============================================================================

-- 1) Tabela
CREATE TABLE IF NOT EXISTS public.manual_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- category_code = rotulo digitado (serve de chave em category_mapping).
  category_code text NOT NULL,
  category_name text NOT NULL,
  entry_date date NOT NULL,
  value numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE INDEX IF NOT EXISTS manual_entries_company_idx
  ON public.manual_entries(company_id);

CREATE INDEX IF NOT EXISTS manual_entries_company_category_idx
  ON public.manual_entries(company_id, category_code);

-- Touch updated_at on UPDATE (mesmo padrao de manual_account_values)
CREATE OR REPLACE FUNCTION public.manual_entries_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS manual_entries_updated_at ON public.manual_entries;
CREATE TRIGGER manual_entries_updated_at
  BEFORE UPDATE ON public.manual_entries
  FOR EACH ROW EXECUTE FUNCTION public.manual_entries_touch_updated_at();

-- 2) RLS (mesmo padrao de manual_account_values)
ALTER TABLE public.manual_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read manual_entries by permission" ON public.manual_entries;
CREATE POLICY "Read manual_entries by permission"
ON public.manual_entries
FOR SELECT
TO authenticated
USING (
  public.is_admin()
  OR public.is_hero_manager()
  OR company_id IN (
    SELECT u.company_id
    FROM public.users u
    WHERE u.id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Write manual_entries admin" ON public.manual_entries;
CREATE POLICY "Write manual_entries admin"
ON public.manual_entries
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- =============================================================================
-- 3) RPCs do DRE recriadas com a fonte manual_entries
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
  ),
  manual_entry_amounts AS (
    SELECT
      me.company_id,
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
    GROUP BY me.company_id, mapping.dre_account_id
  )
  SELECT company_id, dre_account_id, sum(amount)::numeric AS amount
  FROM (
    SELECT * FROM omie_amounts
    UNION ALL
    SELECT * FROM manual_amounts
    UNION ALL
    SELECT * FROM manual_entry_amounts
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
    UNION ALL
    -- Lancamentos manuais (manual_entries) resolvidos pelo mesmo category_mapping.
    SELECT
      me.id AS financial_entry_id,
      me.entry_date AS payment_date,
      me.category_name AS description,
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
