-- =============================================================================
-- Pre-agregacao do Fluxo de Caixa: cash_flow_monthly_aggregates (Opcao 1 / Fase 2)
-- =============================================================================
-- Mesma estrategia da pre-agregacao do DRE (20260605120000), agora para os
-- MOVIMENTOS de caixa. cash_flow_aggregate / _by_company varriam financial_entries
-- e resolviam o mapeamento linha-a-linha, e a tela do Fluxo chama essas RPCs
-- MUITAS vezes por carregamento (uma por mes + acumulado + baseline desde o
-- inicio da historia + saldo inicial). Por isso o Fluxo continuava lento mesmo
-- depois de materializar o DRE.
--
-- Agora os movimentos sao materializados por (empresa efetiva, conta de fluxo,
-- ano, mes), e as RPCs apenas SOMAM a tabela. Sem fontes manuais (o fluxo le so
-- financial_entries) e sem filtro de projeto (so o de rateio de departamento).
--
-- Recalculo via `refresh_cash_flow_monthly_aggregates(...)` no sync e nas
-- mudancas de mapeamento de fluxo. Backfill no fim desta migration. A versao
-- AO VIVO fica como `cash_flow_aggregate_live` para validacao.
-- =============================================================================

-- 1) Tabela
CREATE TABLE IF NOT EXISTS public.cash_flow_monthly_aggregates (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cash_flow_account_id uuid NOT NULL REFERENCES public.cash_flow_accounts(id) ON DELETE CASCADE,
  year integer NOT NULL,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount numeric NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, cash_flow_account_id, year, month)
);

CREATE INDEX IF NOT EXISTS cash_flow_monthly_aggregates_company_period_idx
  ON public.cash_flow_monthly_aggregates (company_id, year, month);

-- 2) RLS — mesmo acesso de leitura do DRE materializado.
ALTER TABLE public.cash_flow_monthly_aggregates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read cash_flow_monthly_aggregates by access" ON public.cash_flow_monthly_aggregates;
CREATE POLICY "Read cash_flow_monthly_aggregates by access"
ON public.cash_flow_monthly_aggregates
FOR SELECT
TO authenticated
USING (
  public.is_admin()
  OR public.is_hero_manager()
  OR public.user_has_company_access(company_id)
  OR company_id IN (
    SELECT u.company_id FROM public.users u WHERE u.id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Write cash_flow_monthly_aggregates admin" ON public.cash_flow_monthly_aggregates;
CREATE POLICY "Write cash_flow_monthly_aggregates admin"
ON public.cash_flow_monthly_aggregates
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 3) Refresh. p_company_ids = empresas EFETIVAS a recomputar; NULL = todas.
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

GRANT EXECUTE ON FUNCTION public.refresh_cash_flow_monthly_aggregates(uuid[]) TO authenticated, service_role;

-- 4) RPCs de leitura -> somam a tabela materializada.
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
  SELECT cma.cash_flow_account_id, sum(cma.amount)::numeric AS amount
  FROM public.cash_flow_monthly_aggregates cma
  WHERE cma.company_id = ANY(p_company_ids)
    AND make_date(cma.year, cma.month, 1)
          BETWEEN date_trunc('month', p_date_from)::date
              AND date_trunc('month', p_date_to)::date
  GROUP BY cma.cash_flow_account_id;
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
  SELECT cma.company_id, cma.cash_flow_account_id, sum(cma.amount)::numeric AS amount
  FROM public.cash_flow_monthly_aggregates cma
  WHERE cma.company_id = ANY(p_company_ids)
    AND make_date(cma.year, cma.month, 1)
          BETWEEN date_trunc('month', p_date_from)::date
              AND date_trunc('month', p_date_to)::date
  GROUP BY cma.company_id, cma.cash_flow_account_id;
$$;

GRANT EXECUTE ON FUNCTION public.cash_flow_aggregate_by_company(uuid[], date, date) TO authenticated;

-- 5) Versao AO VIVO (calculo antigo) — apenas para validacao via /api/debug-aggregates.
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

GRANT EXECUTE ON FUNCTION public.cash_flow_aggregate_live(uuid[], date, date) TO authenticated;

-- 6) Backfill: popula a tabela para TODAS as empresas agora.
SELECT public.refresh_cash_flow_monthly_aggregates(NULL);
