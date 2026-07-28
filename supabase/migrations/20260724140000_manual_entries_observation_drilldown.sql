-- Lançamentos manuais: campo Observação + o drill-down passa a exibi-lo.
--
-- Antes, no drill-down do DRE, cada lançamento manual repetia a categoria como
-- descrição. Agora `manual_entries.observation` (texto livre) é usado como a
-- descrição quando preenchido (senão cai na categoria).
--
-- Recria `dashboard_dre_drilldown` com a lógica de financial_entries MAIS
-- RECENTE (base 20260618150000) E a fonte manual_entries — que a versão só-FE
-- havia deixado de fora — agora com a observação. Todos os drill-downs do DRE
-- (Dashboard, Previsto × Realizado, Comparativos Anuais) usam esta função, então
-- a mudança vale para os três. O fluxo de caixa tem drill-down próprio
-- (cash_flow_drilldown), com fonte separada, e não é afetado.

-- 1) Coluna de observação
ALTER TABLE public.manual_entries
  ADD COLUMN IF NOT EXISTS observation text;

-- 2) Drill-down do DRE
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

GRANT EXECUTE ON FUNCTION public.dashboard_dre_drilldown(uuid, uuid[], date, date, text, integer, integer) TO authenticated;
