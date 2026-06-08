-- =============================================================================
-- Pre-agregacao do DRE: dre_monthly_aggregates (Opcao 1 / materializacao)
-- =============================================================================
-- Problema: dashboard_dre_aggregate / _by_company varriam financial_entries e
-- resolviam o mapeamento (roteamento + rateio + projeto + multi-camada) LINHA A
-- LINHA, a CADA carregamento de tela, e isso era chamado N vezes por pagina
-- (por mes, por empresa). Em segmentos grandes (franquias-viva) estourava o
-- tempo limite da funcao serverless na Vercel.
--
-- Solucao: materializar o resultado da parte cara (so a fonte 'omie') em uma
-- tabela pequena, agregada por (empresa efetiva, conta DRE, ano, mes). As RPCs
-- de leitura passam a SOMAR essa tabela (rapido) e juntam as fontes manuais
-- (manual_account_values / manual_entries), que sao pequenas, AO VIVO.
--
-- A tabela e recalculada por `refresh_dre_monthly_aggregates(...)`:
--   - no fim do sync de cada empresa (mantem fresca diariamente);
--   - quando muda o mapeamento de categorias.
-- E populada de imediato no fim desta migration (backfill), entao as RPCs ja
-- devolvem dados corretos desde a 1a requisicao (sem janela vazia).
--
-- A funcao de refresh reusa EXATAMENTE a mesma logica de resolucao das RPCs
-- atuais (20260603120000) — apenas agrupando por mes —, minimizando o risco de
-- divergencia de numeros. O drilldown e o consistency_check continuam AO VIVO
-- (precisam de linhas individuais). budget_aggregate e cash_flow_* nao mudam.
-- =============================================================================

-- 1) Tabela
CREATE TABLE IF NOT EXISTS public.dre_monthly_aggregates (
  -- company_id = empresa EFETIVA (apos roteamento de departamento).
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  dre_account_id uuid NOT NULL REFERENCES public.dre_accounts(id) ON DELETE CASCADE,
  year integer NOT NULL,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount numeric NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, dre_account_id, year, month)
);

CREATE INDEX IF NOT EXISTS dre_monthly_aggregates_company_period_idx
  ON public.dre_monthly_aggregates (company_id, year, month);

-- 2) RLS — espelha o acesso de leitura de financial_entries (admin/hero +
--    user_company_access + legado users.company_id). Leitura pela empresa
--    EFETIVA, que ja e a empresa que o usuario enxergaria.
ALTER TABLE public.dre_monthly_aggregates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read dre_monthly_aggregates by access" ON public.dre_monthly_aggregates;
CREATE POLICY "Read dre_monthly_aggregates by access"
ON public.dre_monthly_aggregates
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

DROP POLICY IF EXISTS "Write dre_monthly_aggregates admin" ON public.dre_monthly_aggregates;
CREATE POLICY "Write dre_monthly_aggregates admin"
ON public.dre_monthly_aggregates
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 3) Funcao de refresh. p_company_ids = empresas EFETIVAS a recomputar; NULL =
--    todas. Recalcula TODO o historico das empresas-alvo (delete + insert).
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
    AND da.data_source = 'omie'
    AND (p_company_ids IS NULL
         OR COALESCE(route.routed_to_company_id, fe.company_id) = ANY(p_company_ids))
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
  GROUP BY 1, 2, 3, 4;
END;
$$;

-- Cron (service_role) e sync manual / telas de mapeamento (authenticated, mas
-- sempre admin no app) precisam poder disparar o refresh.
GRANT EXECUTE ON FUNCTION public.refresh_dre_monthly_aggregates(uuid[]) TO authenticated, service_role;

-- 4) Reescreve as RPCs de leitura para somar a tabela materializada (fonte
--    'omie') + as fontes manuais ao vivo. Assinaturas inalteradas.
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
    SELECT dma.dre_account_id, sum(dma.amount)::numeric AS amount
    FROM public.dre_monthly_aggregates dma
    WHERE dma.company_id = ANY(p_company_ids)
      AND make_date(dma.year, dma.month, 1)
            BETWEEN date_trunc('month', p_date_from)::date
                AND date_trunc('month', p_date_to)::date
    GROUP BY dma.dre_account_id
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
    SELECT dma.company_id, dma.dre_account_id, sum(dma.amount)::numeric AS amount
    FROM public.dre_monthly_aggregates dma
    WHERE dma.company_id = ANY(p_company_ids)
      AND make_date(dma.year, dma.month, 1)
            BETWEEN date_trunc('month', p_date_from)::date
                AND date_trunc('month', p_date_to)::date
    GROUP BY dma.company_id, dma.dre_account_id
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

-- 5) Versao "AO VIVO" (calculo antigo, varrendo financial_entries) mantida APENAS
--    para validacao: o endpoint /api/debug-aggregates compara esta com a versao
--    materializada e confirma que batem. Nao e usada pelas telas.
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

GRANT EXECUTE ON FUNCTION public.dashboard_dre_aggregate_live(uuid[], date, date) TO authenticated;

-- 6) Backfill: popula a tabela para TODAS as empresas agora, para as RPCs ja
--    devolverem dados corretos desde a 1a requisicao apos o deploy.
SELECT public.refresh_dre_monthly_aggregates(NULL);
