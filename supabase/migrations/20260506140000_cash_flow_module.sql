-- =============================================================================
-- Modulo Fluxo de Caixa.
--
-- Cria estrutura paralela ao DRE para a Demonstracao de Fluxo de Caixa (DFC):
--   1. cash_flow_accounts: hierarquia de contas (Resultado do Exercicio,
--      Emprestimos e Mutuos, Investimentos, Dividendos, Aportes, e bloco
--      destaque com Saldo Inicial / Caixa Gerado / Caixa Final).
--   2. cash_flow_category_mappings: vinculo Categoria Omie -> Conta de Fluxo,
--      com suporte a departamento (different from DRE mapping which is
--      category-only). Departamento NULL = mapeamento aplica a todos os
--      departamentos.
--   3. cash_flow_opening_balances: saldo inicial manual por empresa/mes.
--      Permite ajuste durante a conferencia financeira.
--
-- A linha "Resultado do Exercicio" nao recebe mapeamento — seu valor vem
-- automaticamente do DRE (conta com code='11') no mesmo periodo/empresa.
-- O bloco destaque (Saldo Inicial / Caixa Gerado / Caixa Final) tem
-- is_highlight_block=true e source preenchido para sinalizar logica especial.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.cash_flow_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  parent_id uuid REFERENCES public.cash_flow_accounts(id) ON DELETE RESTRICT,
  level integer NOT NULL CHECK (level >= 1),
  type text NOT NULL CHECK (type IN ('receita', 'despesa', 'calculado', 'misto')),
  is_summary boolean NOT NULL DEFAULT false,
  formula text,
  source text, -- 'dre_resultado_exercicio' | 'cash_balance_initial' | 'cash_balance_final' | NULL (mapeamento normal)
  is_highlight_block boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cash_flow_accounts_parent_sort_idx
  ON public.cash_flow_accounts(parent_id, sort_order, code);

CREATE TABLE IF NOT EXISTS public.cash_flow_category_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  omie_category_code text NOT NULL,
  omie_category_name text NOT NULL,
  cash_flow_account_id uuid NOT NULL REFERENCES public.cash_flow_accounts(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  omie_department_code text, -- NULL = aplica a todos os departamentos
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

-- Unicidade: nao permitir duas regras para a mesma combinacao
-- (categoria, conta, empresa, departamento). NULL participa do unique
-- via coalesce com sentinelas.
CREATE UNIQUE INDEX IF NOT EXISTS cash_flow_category_mappings_unique_scope_idx
  ON public.cash_flow_category_mappings(
    omie_category_code,
    cash_flow_account_id,
    coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(omie_department_code, '__none__')
  );

CREATE INDEX IF NOT EXISTS cash_flow_category_mappings_company_idx
  ON public.cash_flow_category_mappings(company_id, cash_flow_account_id);

CREATE TABLE IF NOT EXISTS public.cash_flow_opening_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  period_year integer NOT NULL,
  period_month integer NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  amount numeric(16, 2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (company_id, period_year, period_month)
);

CREATE INDEX IF NOT EXISTS cash_flow_opening_balances_company_period_idx
  ON public.cash_flow_opening_balances(company_id, period_year, period_month);

-- ─── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.cash_flow_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_flow_category_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_flow_opening_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read cash_flow_accounts authenticated"
ON public.cash_flow_accounts
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Write cash_flow_accounts admin"
ON public.cash_flow_accounts
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "Read cash_flow_category_mappings by permission"
ON public.cash_flow_category_mappings
FOR SELECT
TO authenticated
USING (
  public.is_admin()
  OR public.is_hero_manager()
  OR company_id IS NULL
  OR company_id IN (
    SELECT u.company_id
    FROM public.users u
    WHERE u.id = auth.uid()
  )
);

CREATE POLICY "Write cash_flow_category_mappings admin"
ON public.cash_flow_category_mappings
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "Read cash_flow_opening_balances by permission"
ON public.cash_flow_opening_balances
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

CREATE POLICY "Write cash_flow_opening_balances admin"
ON public.cash_flow_opening_balances
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- ─── RPCs ──────────────────────────────────────────────────────────────────
-- Agrega financial_entries por conta de fluxo de caixa, respeitando
-- mapeamento por categoria+departamento+empresa e o filtro
-- has_department_apportionment.
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
  CROSS JOIN LATERAL (
    -- Prioridade: empresa+departamento > empresa-only > global+departamento > global.
    -- Empresa especifica > global. Departamento especifico > NULL (todos).
    SELECT cm.cash_flow_account_id
    FROM public.cash_flow_category_mappings cm
    WHERE cm.omie_category_code = fe.category_code
      AND (cm.company_id = fe.company_id OR cm.company_id IS NULL)
      AND (cm.omie_department_code IS NULL
           OR cm.omie_department_code = fe.department_code)
    ORDER BY
      (cm.company_id IS NOT NULL) DESC,
      (cm.omie_department_code IS NOT NULL) DESC
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
    fe.company_id,
    mapping.cash_flow_account_id,
    sum(fe.value)::numeric AS amount
  FROM public.financial_entries fe
  JOIN public.companies c ON c.id = fe.company_id
  CROSS JOIN LATERAL (
    SELECT cm.cash_flow_account_id
    FROM public.cash_flow_category_mappings cm
    WHERE cm.omie_category_code = fe.category_code
      AND (cm.company_id = fe.company_id OR cm.company_id IS NULL)
      AND (cm.omie_department_code IS NULL
           OR cm.omie_department_code = fe.department_code)
    ORDER BY
      (cm.company_id IS NOT NULL) DESC,
      (cm.omie_department_code IS NOT NULL) DESC
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
  GROUP BY fe.company_id, mapping.cash_flow_account_id;
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
    CROSS JOIN LATERAL (
      SELECT cm.cash_flow_account_id
      FROM public.cash_flow_category_mappings cm
      WHERE cm.omie_category_code = fe.category_code
        AND (cm.company_id = fe.company_id OR cm.company_id IS NULL)
        AND (cm.omie_department_code IS NULL
             OR cm.omie_department_code = fe.department_code)
      ORDER BY
        (cm.company_id IS NOT NULL) DESC,
        (cm.omie_department_code IS NOT NULL) DESC
      LIMIT 1
    ) mapping
    WHERE fe.payment_date BETWEEN p_date_from AND p_date_to
      AND fe.company_id = ANY(p_company_ids)
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

-- ─── Seed inicial da estrutura ─────────────────────────────────────────────
WITH cash_flow_seed(code, name, parent_code, type, is_summary, formula, source, is_highlight_block, sort_order) AS (
  VALUES
    ('1', 'Resultado do Exercicio', NULL, 'calculado', false, NULL, 'dre_resultado_exercicio', false, 1),

    ('2', 'Emprestimos e Mutuos', NULL, 'misto', true, NULL, NULL, false, 2),
    ('2.1', 'Emprestimos Bancarios', '2', 'receita', false, NULL, NULL, false, 1),
    ('2.2', 'Pagamento de Emprestimos', '2', 'despesa', false, NULL, NULL, false, 2),

    ('3', 'Investimentos', NULL, 'misto', true, NULL, NULL, false, 3),
    ('3.1', 'Maquinas e Equipamentos', '3', 'despesa', false, NULL, NULL, false, 1),
    ('3.2', 'Veiculos', '3', 'despesa', false, NULL, NULL, false, 2),
    ('3.3', 'Instalacoes', '3', 'despesa', false, NULL, NULL, false, 3),
    ('3.4', 'Equipamentos de Informatica', '3', 'despesa', false, NULL, NULL, false, 4),
    ('3.5', 'Moveis e Utensilios', '3', 'despesa', false, NULL, NULL, false, 5),
    ('3.6', 'Imobilizado', '3', 'despesa', false, NULL, NULL, false, 6),

    ('4', 'Dividendos', NULL, 'misto', true, NULL, NULL, false, 4),
    ('4.1', 'Dividendos Recebidos', '4', 'receita', false, NULL, NULL, false, 1),
    ('4.2', 'Dividendos Pagos', '4', 'despesa', false, NULL, NULL, false, 2),

    ('5', 'Aportes', NULL, 'misto', true, NULL, NULL, false, 5),
    ('5.1', 'Aumento de Capital', '5', 'receita', false, NULL, NULL, false, 1),

    -- Bloco destaque "Fluxo de Caixa". sort_order >= 90 garante que renderiza
    -- apos as totalizadoras analiticas. is_highlight_block=true sinaliza para
    -- o componente de visualizacao usar estilo diferenciado.
    ('90.1', 'Saldo Inicial de Caixa', NULL, 'calculado', false, NULL, 'cash_balance_initial', true, 90),
    ('90.2', 'Caixa Gerado/Consumido', NULL, 'calculado', true, '1+2+3+4+5', NULL, true, 91),
    ('90.3', 'Caixa Final', NULL, 'calculado', true, '90.1+90.2', 'cash_balance_final', true, 92)
),
upserted AS (
  INSERT INTO public.cash_flow_accounts (code, name, level, type, is_summary, formula, source, is_highlight_block, sort_order, active)
  SELECT
    s.code,
    s.name,
    array_length(string_to_array(s.code, '.'), 1) AS level,
    s.type,
    s.is_summary,
    s.formula,
    s.source,
    s.is_highlight_block,
    s.sort_order,
    true
  FROM cash_flow_seed s
  ON CONFLICT (code) DO UPDATE
  SET
    name = excluded.name,
    level = excluded.level,
    type = excluded.type,
    is_summary = excluded.is_summary,
    formula = excluded.formula,
    source = excluded.source,
    is_highlight_block = excluded.is_highlight_block,
    sort_order = excluded.sort_order,
    active = excluded.active
  RETURNING id, code
)
UPDATE public.cash_flow_accounts child
SET parent_id = parent.id
FROM cash_flow_seed seed
LEFT JOIN public.cash_flow_accounts parent
  ON parent.code = seed.parent_code
WHERE child.code = seed.code;
