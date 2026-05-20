-- =============================================================================
-- Socios da empresa — quadro societario por empresa.
--
-- Permite que o modulo Fluxo de Caixa detalhe os valores das linhas
-- "Dividendos Pagos" (4.2) e "Aumento de Capital" (5.1) por socio:
--
--   4. Dividendos
--   4.1 Dividendos Recebidos
--   4.2 Dividendos Pagos
--     4.2.1 Joao
--     4.2.2 Pedro
--
--   5. Aportes
--   5.1 Aumento de Capital
--     5.1.1 Joao
--     5.1.2 Pedro
--
-- Modelo:
--   1. company_partners: cadastro de socio. Cada empresa pode ter N socios,
--      com `sort_order` para controlar a ordem de exibicao (define 4.2.1,
--      4.2.2, ...). Nome livre — o admin digita exatamente o nome que deve
--      aparecer no fluxo de caixa.
--   2. company_partner_supplier_links: nomes de cliente/fornecedor da Omie
--      vinculados a cada socio. Um socio pode estar vinculado a N
--      clientes/fornecedores; o matching com fe.supplier_customer e feito
--      por igualdade exata (texto identico, case-sensitive).
--
-- O total das linhas 4.2 / 5.1 continua vindo do mapeamento normal de
-- categoria (cash_flow_category_mappings). Os subniveis por socio
-- consomem o mesmo conjunto de lancamentos, particionado pelo
-- supplier_customer. Valores nao vinculados a nenhum socio NAO aparecem
-- em subniveis — somente no total 4.2 / 5.1 (regra explicita do produto).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.company_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS company_partners_company_idx
  ON public.company_partners (company_id, sort_order, id);

CREATE TABLE IF NOT EXISTS public.company_partner_supplier_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.company_partners(id) ON DELETE CASCADE,
  -- Snapshot do company_id para acelerar joins/RLS sem precisar joinar
  -- company_partners. Sincronizado por trigger.
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  supplier_customer text NOT NULL CHECK (length(trim(supplier_customer)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Mesmo nome de cliente/fornecedor nao pode estar vinculado a dois
  -- socios na mesma empresa — isso quebraria a particao.
  UNIQUE (company_id, supplier_customer)
);

CREATE INDEX IF NOT EXISTS company_partner_supplier_links_partner_idx
  ON public.company_partner_supplier_links (partner_id);

CREATE INDEX IF NOT EXISTS company_partner_supplier_links_company_idx
  ON public.company_partner_supplier_links (company_id, supplier_customer);

-- Mantem company_partner_supplier_links.company_id em sync com o partner.
CREATE OR REPLACE FUNCTION public.company_partner_supplier_links_set_company_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  SELECT cp.company_id INTO NEW.company_id
  FROM public.company_partners cp
  WHERE cp.id = NEW.partner_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_partner_supplier_links_set_company_id_trg
  ON public.company_partner_supplier_links;
CREATE TRIGGER company_partner_supplier_links_set_company_id_trg
BEFORE INSERT OR UPDATE OF partner_id ON public.company_partner_supplier_links
FOR EACH ROW EXECUTE FUNCTION public.company_partner_supplier_links_set_company_id();

-- ─── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.company_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_partner_supplier_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read company_partners by permission"
ON public.company_partners
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

CREATE POLICY "Write company_partners admin"
ON public.company_partners
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "Read company_partner_supplier_links by permission"
ON public.company_partner_supplier_links
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

CREATE POLICY "Write company_partner_supplier_links admin"
ON public.company_partner_supplier_links
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- ─── RPCs ──────────────────────────────────────────────────────────────────

-- Lista os clientes/fornecedores candidatos a vincular a um socio:
-- supplier_customer DISTINCT que apareceram em lancamentos cuja categoria
-- esta mapeada para a conta "Dividendos Pagos" (4.2) ou "Aumento de
-- Capital" (5.1) — escopo da regra de negocio.
--
-- O mapeamento e por categoria (departamento ja nao existe nesta tabela
-- desde 20260506150000_cash_flow_drop_department_mapping) — usamos a
-- mesma logica de prioridade do cash_flow_aggregate: empresa especifica
-- vence sobre mapeamento global.
CREATE OR REPLACE FUNCTION public.company_partner_candidates(
  p_company_id uuid
)
RETURNS TABLE (
  supplier_customer text,
  occurrences bigint,
  total_value numeric,
  last_payment_date date
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH partner_accounts AS (
    SELECT id
    FROM public.cash_flow_accounts
    WHERE code IN ('4.2', '5.1')
      AND active = true
  )
  SELECT
    fe.supplier_customer,
    count(*)::bigint AS occurrences,
    sum(fe.value)::numeric AS total_value,
    max(fe.payment_date)::date AS last_payment_date
  FROM public.financial_entries fe
  CROSS JOIN LATERAL (
    SELECT cm.cash_flow_account_id
    FROM public.cash_flow_category_mappings cm
    WHERE cm.omie_category_code = fe.category_code
      AND (cm.company_id = fe.company_id OR cm.company_id IS NULL)
    ORDER BY cm.company_id NULLS LAST
    LIMIT 1
  ) mapping
  WHERE fe.company_id = p_company_id
    AND fe.category_code IS NOT NULL
    AND fe.supplier_customer IS NOT NULL
    AND length(trim(fe.supplier_customer)) > 0
    AND mapping.cash_flow_account_id IN (SELECT id FROM partner_accounts)
  GROUP BY fe.supplier_customer
  ORDER BY count(*) DESC, fe.supplier_customer;
$$;

GRANT EXECUTE ON FUNCTION public.company_partner_candidates(uuid) TO authenticated;

-- Agrega valores por socio (e por conta de fluxo de caixa: 4.2 ou 5.1)
-- para a empresa no periodo. Devolve apenas socios que efetivamente
-- receberam algum valor — chamador junta com a lista cadastrada para
-- mostrar tambem socios zerados.
--
-- Filtros aplicados:
--   - Mesma regra de prioridade do cash_flow_aggregate (categoria,
--     empresa).
--   - Mesmo filtro de departamentos incluidos
--     (has_department_apportionment + company_departments.included).
--   - Apenas lancamentos cujo supplier_customer esta vinculado a algum
--     socio da empresa (match exato).
CREATE OR REPLACE FUNCTION public.cash_flow_partner_breakdown(
  p_company_id uuid,
  p_date_from date,
  p_date_to date
)
RETURNS TABLE (
  partner_id uuid,
  cash_flow_account_id uuid,
  amount numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    link.partner_id,
    mapping.cash_flow_account_id,
    sum(fe.value)::numeric AS amount
  FROM public.financial_entries fe
  JOIN public.companies c ON c.id = fe.company_id
  JOIN public.company_partner_supplier_links link
    ON link.company_id = fe.company_id
    AND link.supplier_customer = fe.supplier_customer
  CROSS JOIN LATERAL (
    SELECT cm.cash_flow_account_id
    FROM public.cash_flow_category_mappings cm
    WHERE cm.omie_category_code = fe.category_code
      AND (cm.company_id = fe.company_id OR cm.company_id IS NULL)
    ORDER BY cm.company_id NULLS LAST
    LIMIT 1
  ) mapping
  WHERE fe.payment_date BETWEEN p_date_from AND p_date_to
    AND fe.company_id = p_company_id
    AND fe.category_code IS NOT NULL
    AND mapping.cash_flow_account_id IN (
      SELECT id
      FROM public.cash_flow_accounts
      WHERE code IN ('4.2', '5.1')
        AND active = true
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
  GROUP BY link.partner_id, mapping.cash_flow_account_id;
$$;

GRANT EXECUTE ON FUNCTION public.cash_flow_partner_breakdown(uuid, date, date) TO authenticated;
