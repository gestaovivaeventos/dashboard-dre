-- =============================================================================
-- Feat Producoes — Linhas do Google Sheets passam a SOMAR a Omie elegivel
-- =============================================================================
-- Contexto:
--   A Feat Producoes alimenta 6 linhas da DRE a partir de uma planilha do Google
--   Sheets (feat-sync.ts -> manual_account_values). Essas contas custom da Feat
--   estao marcadas com `dre_accounts.data_source = 'sheets'`:
--     1.1  Resultado dos eventos
--     3.1  ISS
--     3.2  PIS
--     3.3  COFINS
--     9    IRPJ
--     10   Contribuicao Social (CSLL)
--
--   Ate aqui, a agregacao da DRE materializava em `dre_monthly_aggregates`
--   APENAS contas `data_source = 'omie'` (refresh_dre_monthly_aggregates). Como
--   essas 6 contas sao 'sheets', os lancamentos da Omie mapeados para elas eram
--   IGNORADOS no dashboard — a linha mostrava SO o valor da planilha. (O
--   drilldown ja listava esses lancamentos, gerando divergencia dashboard x
--   drilldown.)
--
-- Melhoria (ESCOPO EXCLUSIVO Feat Producoes):
--   Nessas 6 linhas, o valor final passa a ser:
--       valor do Google Sheets  +  soma dos lancamentos ELEGIVEIS da Omie
--   onde "elegivel" segue a regra JA VALIDADA da Feat (gate
--   `dre_entry_excluded_by_project` + filtro de departamento, ambos ja presentes
--   no refresh): entra o lancamento SEM projeto, ou com projeto cujo nome comeca
--   exatamente com "N.O."; lancamento com projeto que NAO comeca com "N.O." NAO
--   entra (nem no dashboard, nem no drilldown).
--
-- Como (mudanca minima e isolada):
--   • Novo flag por empresa `companies.dre_sum_sheets_with_omie` (default false),
--     ligado SOMENTE para a Feat Producoes — mesmo padrao de isolamento de
--     `dre_exclude_linked_projects`.
--   • `refresh_dre_monthly_aggregates` passa a materializar tambem as contas
--     `data_source = 'sheets'` QUANDO a empresa efetiva tem o flag ligado. Assim
--     os lancamentos elegiveis da Omie dessas 6 contas entram em
--     `dre_monthly_aggregates` (ramo "omie"). O valor do Google Sheets continua
--     vindo de `manual_account_values` (ramo "manual") — o `UNION ALL` das RPCs
--     de leitura SOMA os dois. Nenhuma linha e duplicada (fontes distintas:
--     financial_entries vs manual_account_values).
--   • `dashboard_dre_aggregate_live` (versao de validacao usada so pelo
--     /api/debug-aggregates) recebe a MESMA relaxacao, para continuar batendo
--     com a versao materializada.
--
-- O que esta migration NAO altera:
--   • A leitura/gravacao do Google Sheets (manual_account_values) — intacta.
--   • A regra de projeto da Feat (dre_entry_excluded_by_project) — intacta e
--     reaproveitada.
--   • O mapeamento de categorias, os dados da Omie e o plano DRE — intactos.
--   • Outras empresas: sem o flag e sem contas 'sheets', o comportamento delas
--     e identico (a condicao extra e inerte).
--   • As RPCs dashboard_dre_aggregate / _by_company / drilldown — nao precisam
--     mudar: ja somam dre_monthly_aggregates + manual_account_values e o
--     drilldown ja casa por `code` sem filtro de data_source.
-- =============================================================================

-- 1) Flag por empresa (default false => nada muda para as demais empresas).
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS dre_sum_sheets_with_omie boolean NOT NULL DEFAULT false;

-- 2) Liga apenas para a Feat Producoes (mesma identificacao por nome ja usada
--    nas migrations da Feat). Idempotente.
UPDATE public.companies
  SET dre_sum_sheets_with_omie = true
  WHERE name = 'Feat Producoes';

-- 3) refresh_dre_monthly_aggregates: materializa 'omie' SEMPRE e 'sheets' apenas
--    para empresas com o flag ligado. Base: 20260605120000 (unica mudanca e a
--    condicao de data_source).
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
    AND (
      da.data_source = 'omie'
      -- Feat: linhas do Google Sheets ('sheets') tambem materializam a Omie
      -- elegivel, para somar com o valor da planilha. Gated pelo flag => inerte
      -- para qualquer outra empresa.
      OR (da.data_source = 'sheets'
          AND COALESCE(co.dre_sum_sheets_with_omie, false))
    )
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

GRANT EXECUTE ON FUNCTION public.refresh_dre_monthly_aggregates(uuid[]) TO authenticated, service_role;

-- 4) dashboard_dre_aggregate_live: mesma relaxacao, para a validacao do
--    /api/debug-aggregates continuar batendo com a versao materializada.
--    Base: 20260605120000 (unica mudanca e a condicao de data_source).
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
      AND (
        da.data_source = 'omie'
        OR (da.data_source = 'sheets'
            AND COALESCE(co.dre_sum_sheets_with_omie, false))
      )
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

-- 5) Backfill: recomputa a materializacao APENAS das empresas com o flag (Feat),
--    para o dashboard ja refletir a soma desde a 1a requisicao apos o deploy.
--    Nao toca nas linhas das demais empresas.
DO $$
DECLARE
  v_ids uuid[];
BEGIN
  SELECT array_agg(id) INTO v_ids
  FROM public.companies
  WHERE dre_sum_sheets_with_omie = true;

  IF v_ids IS NOT NULL THEN
    PERFORM public.refresh_dre_monthly_aggregates(v_ids);
  END IF;
END $$;
