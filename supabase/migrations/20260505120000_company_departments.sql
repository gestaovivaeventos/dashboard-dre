-- =============================================================================
-- Departamentos Omie — configuracao por empresa.
--
-- Algumas empresas operam com rateio por departamento na Omie (ex.: empresa
-- com unidade de negocio A, B, C). A DRE so deve consolidar lancamentos dos
-- departamentos selecionados por empresa — caso contrario as receitas e
-- despesas misturam unidades e a DRE deixa de fazer sentido.
--
-- Modelo:
--   1. companies.has_department_apportionment (boolean): quando true, ativa o
--      filtro por departamento. Quando false, todos os lancamentos da empresa
--      vao para a DRE (comportamento atual).
--   2. company_departments: catalogo dos departamentos cadastrados na Omie
--      daquela empresa, espelhado via API ListarDepartamentos. Cada linha
--      tem `included` (boolean) que indica se aquele departamento entra na
--      DRE. Existe tambem um codigo sentinela `__none__` para lancamentos
--      sem vinculo a departamento — a Omie nao retorna isso na API mas o
--      usuario precisa poder marca-lo, caso contrario lancamentos "sem
--      departamento" ficariam invisiveis na DRE quando o filtro estiver ativo.
--   3. financial_entries.department_code: codigo do departamento extraido do
--      lancamento na Omie (NULL quando sem vinculo). Populado pelo processor
--      financeiro a cada sync.
--
-- O filtro e aplicado nos RPCs de aggregate, drilldown e consistency_check —
-- inline via WHERE para nao introduzir VIEW/funcao extra no hot path.
-- =============================================================================

-- 1. Flag de rateio por departamento na empresa.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS has_department_apportionment boolean NOT NULL DEFAULT false;

-- 2. Catalogo de departamentos da empresa.
CREATE TABLE IF NOT EXISTS public.company_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  omie_code text NOT NULL,
  name text NOT NULL,
  included boolean NOT NULL DEFAULT false,
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, omie_code)
);

CREATE INDEX IF NOT EXISTS company_departments_company_idx
  ON public.company_departments (company_id);

-- 3. department_code em financial_entries.
ALTER TABLE public.financial_entries
  ADD COLUMN IF NOT EXISTS department_code text;

CREATE INDEX IF NOT EXISTS financial_entries_company_dept_idx
  ON public.financial_entries (company_id, department_code);

-- 4. RLS para company_departments.
ALTER TABLE public.company_departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read company_departments by permission" ON public.company_departments;
CREATE POLICY "Read company_departments by permission"
ON public.company_departments
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

DROP POLICY IF EXISTS "Write company_departments by admin" ON public.company_departments;
CREATE POLICY "Write company_departments by admin"
ON public.company_departments
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 5. dashboard_dre_aggregate com filtro por departamento.
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
  SELECT
    mapping.dre_account_id,
    sum(fe.value)::numeric AS amount
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
  WHERE fe.payment_date BETWEEN p_date_from AND p_date_to
    AND fe.company_id = ANY(p_company_ids)
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
  GROUP BY mapping.dre_account_id;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_dre_aggregate(uuid[], date, date) TO authenticated;

-- 6. dashboard_dre_aggregate_by_company com filtro por departamento.
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
  SELECT
    fe.company_id,
    mapping.dre_account_id,
    sum(fe.value)::numeric AS amount
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
  WHERE fe.payment_date BETWEEN p_date_from AND p_date_to
    AND fe.company_id = ANY(p_company_ids)
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
  GROUP BY fe.company_id, mapping.dre_account_id;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_dre_aggregate_by_company(uuid[], date, date) TO authenticated;

-- 7. dashboard_dre_drilldown com filtro por departamento.
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
    LEFT JOIN public.category_mapping company_mapping
      ON company_mapping.omie_category_code = fe.category_code
      AND company_mapping.company_id = fe.company_id
    LEFT JOIN public.category_mapping global_mapping
      ON global_mapping.omie_category_code = fe.category_code
      AND global_mapping.company_id IS NULL
    WHERE fe.payment_date BETWEEN p_date_from AND p_date_to
      AND fe.company_id = ANY(p_company_ids)
      AND COALESCE(company_mapping.dre_account_id, global_mapping.dre_account_id) = p_dre_account_id
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

-- 8. dashboard_dre_consistency_check com filtro por departamento.
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
      fe.company_id,
      fe.value,
      fe.created_at,
      mapping.dre_account_id
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
    WHERE fe.payment_date BETWEEN p_date_from AND p_date_to
      AND fe.company_id = ANY(p_company_ids)
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
