-- =============================================================================
-- Roteamento de departamento: lancamento ROTEADO nao herda a regra de projeto
-- da empresa de ORIGEM.
-- =============================================================================
-- Sintoma (empresa Sirena):
--   A Sirena e composta pelos lancamentos da Omie da Feat Producoes vinculados
--   ao departamento "Sirena" (company_departments.routed_to_company_id = Sirena).
--   Algumas categorias JA mapeadas na Sirena nao apareciam no dashboard da
--   Sirena — especificamente os lancamentos que possuem PROJETO vinculado.
--
-- Causa raiz:
--   O refresh do materializado (e o drilldown ao vivo) aplicam o gate
--   `dre_entry_excluded_by_project(co.dre_exclude_linked_projects, ...)` usando a
--   empresa de ORIGEM (co = fe.company_id = Feat Producoes). A Feat tem esse flag
--   LIGADO (regra: lancamento com projeto vinculado fica fora da DRE, exceto
--   projeto cujo nome comeca com "N.O."). Como os lancamentos do departamento
--   Sirena ORIGINAM na Feat, a regra de projeto da Feat os excluia ANTES de
--   chegarem na Sirena — mesmo eles devendo compor a DRE da Sirena (que NAO tem
--   essa regra).
--
-- Correcao (cirurgica e isolada):
--   A regra de projeto e ESPECIFICA da empresa de origem e so deve valer para os
--   lancamentos que PERMANECEM nela. Para lancamentos ROTEADOS para outra empresa
--   (route.routed_to_company_id IS NOT NULL, i.e. effective != origem), o gate de
--   projeto da ORIGEM NAO se aplica — o lancamento compoe a DRE do DESTINO
--   conforme o mapeamento/regra do destino.
--
--   Expressao adicionada (no ramo Omie do refresh / drilldown / live):
--       (route.routed_to_company_id IS NOT NULL          -- roteado: ignora regra da origem
--        OR NOT dre_entry_excluded_by_project(co.flag, project_code, project_name))
--
-- Por que isto NAO altera a Feat (nem nenhuma outra empresa):
--   • Lancamentos NAO roteados (route IS NULL) — TODAS as empresas, incl. os
--     proprios lancamentos da Feat: a expressao cai no ramo `NOT
--     dre_entry_excluded_by_project(...)`, IDENTICO ao comportamento atual.
--   • Cubo (Terrazzo) -> Feat: ja era roteado e a origem (Terrazzo) tem o flag
--     DESLIGADO, entao nunca era excluido; agora continua nao sendo excluido
--     (mesmo resultado). A DRE da Feat fica byte-identica.
--   • Feat -> Sirena: agora os lancamentos com projeto deixam de ser excluidos e
--     passam a compor a DRE da Sirena (o fix).
--
-- Escopo: redefine refresh_dre_monthly_aggregates (materializado lido pelo
--   dashboard), dashboard_dre_drilldown (ao vivo) e dashboard_dre_aggregate_live
--   (validacao /api/debug-aggregates) — para dashboard e drilldown usarem
--   EXATAMENTE a mesma regra. Bases: 20260606120000 (refresh + live) e
--   20260602140000 (drilldown). Unica mudanca em cada: o gate de projeto.
--   NAO altera mapeamento, Omie, planilha, plano DRE, nem o flag/funcao
--   dre_entry_excluded_by_project (reaproveitada).
-- =============================================================================

-- 1) refresh_dre_monthly_aggregates (base 20260606120000).
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
      OR (da.data_source = 'sheets'
          AND COALESCE(co.dre_sum_sheets_with_omie, false))
    )
    AND (p_company_ids IS NULL
         OR COALESCE(route.routed_to_company_id, fe.company_id) = ANY(p_company_ids))
    -- Regra de projeto da ORIGEM so vale para lancamentos que PERMANECEM nela.
    -- Lancamentos roteados (effective != origem) ignoram o gate da origem.
    AND (
      route.routed_to_company_id IS NOT NULL
      OR NOT public.dre_entry_excluded_by_project(
           co.dre_exclude_linked_projects, fe.project_code, fe.project_name)
    )
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

-- statement_timeout generoso (igual 20260609180000), pois recriamos a funcao.
ALTER FUNCTION public.refresh_dre_monthly_aggregates(uuid[])
  SET statement_timeout = '180s';

-- 2) dashboard_dre_drilldown (base 20260602140000) — mesmo gate, p/ casar com o
--    dashboard.
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

-- 3) dashboard_dre_aggregate_live (base 20260606120000) — mesma relaxacao, para
--    a validacao do /api/debug-aggregates continuar batendo com o materializado.
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
      AND (
        route.routed_to_company_id IS NOT NULL
        OR NOT public.dre_entry_excluded_by_project(
             co.dre_exclude_linked_projects, fe.project_code, fe.project_name)
      )
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

-- 4) Backfill: recomputa o materializado das empresas que sao DESTINO de
--    roteamento (suas linhas dependem de lancamentos de outra origem). Inclui a
--    Sirena (recebe da Feat) e a Feat (recebe do Cubo/Terrazzo — inalterada,
--    refresh idempotente). Nao toca empresas sem roteamento.
DO $$
DECLARE
  v_ids uuid[];
BEGIN
  SELECT array_agg(DISTINCT routed_to_company_id) INTO v_ids
  FROM public.company_departments
  WHERE routed_to_company_id IS NOT NULL;

  IF v_ids IS NOT NULL THEN
    PERFORM public.refresh_dre_monthly_aggregates(v_ids);
  END IF;
END $$;
