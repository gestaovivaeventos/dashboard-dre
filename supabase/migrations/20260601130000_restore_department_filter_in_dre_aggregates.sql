-- =============================================================================
-- FIX: restaura o filtro por DEPARTAMENTO nos RPCs de agregacao da DRE
-- =============================================================================
-- Sintoma relatado:
--   Apos vincular na tela Configuracoes > Departamentos apenas os departamentos
--   que devem entrar na DRE da Feat Producoes, lancamentos de departamentos NAO
--   selecionados (ex.: Sirena) continuavam aparecendo no DASHBOARD da DRE
--   (embora o drilldown ja os filtrasse corretamente).
--
-- Causa raiz:
--   A migration 20260505120000_company_departments.sql adicionou o filtro por
--   departamento a TODOS os RPCs da DRE (aggregate, by_company, drilldown,
--   consistency_check). Porem, 20260529140000_dashboard_dre_aggregate_with_manual
--   reescreveu as DUAS funcoes de agregacao (aggregate e by_company) para somar
--   manual_account_values e, no processo, OMITIU o filtro por departamento.
--   O drilldown e o consistency_check nao foram tocados por aquela migration e
--   por isso continuaram filtrando — gerando a divergencia: total do dashboard
--   incluia departamentos nao selecionados, mas o drilldown nao.
--   A migration 20260601120000 (regra de projeto da Feat) herdou esse mesmo gap.
--
-- Correcao:
--   Recria as duas funcoes de agregacao = versao atual (20260601120000, com o
--   predicado dre_entry_excluded_by_project preservado) + o MESMO filtro por
--   departamento ja usado pelo drilldown/consistency_check, aplicado apenas no
--   ramo omie (manual_amounts permanece intacto, pois valores manuais nao tem
--   vinculo de departamento).
--
-- Isolamento / seguranca:
--   • O filtro e GATED por `companies.has_department_apportionment`: quando a
--     empresa nao usa rateio por departamento (IS NOT TRUE), o predicado e
--     inerte e o comportamento dela NAO muda.
--   • Para empresas que JA usam rateio e estao validadas, o dashboard passa a
--     refletir exatamente as mesmas selecoes que o drilldown ja respeitava —
--     ou seja, alinha o total ao detalhamento (correcao, nao regressao).
--   • NAO altera nenhum vinculo de departamento (company_departments),
--     categorias, mapeamento, dados da Omie ou a flag de projeto. Apenas a
--     LOGICA DE LEITURA dos RPCs e atualizada.
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
    CROSS JOIN LATERAL (
      SELECT cm.dre_account_id
      FROM public.category_mapping cm
      WHERE cm.omie_category_code = fe.category_code
        AND (cm.company_id = fe.company_id OR cm.company_id IS NULL)
      ORDER BY cm.company_id NULLS LAST
      LIMIT 1
    ) mapping
    JOIN public.dre_accounts da ON da.id = mapping.dre_account_id
    WHERE fe.payment_date BETWEEN p_date_from AND p_date_to
      AND fe.company_id = ANY(p_company_ids)
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
      fe.company_id,
      mapping.dre_account_id,
      sum(fe.value)::numeric AS amount
    FROM public.financial_entries fe
    JOIN public.companies co ON co.id = fe.company_id
    CROSS JOIN LATERAL (
      SELECT cm.dre_account_id
      FROM public.category_mapping cm
      WHERE cm.omie_category_code = fe.category_code
        AND (cm.company_id = fe.company_id OR cm.company_id IS NULL)
      ORDER BY cm.company_id NULLS LAST
      LIMIT 1
    ) mapping
    JOIN public.dre_accounts da ON da.id = mapping.dre_account_id
    WHERE fe.payment_date BETWEEN p_date_from AND p_date_to
      AND fe.company_id = ANY(p_company_ids)
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
    GROUP BY fe.company_id, mapping.dre_account_id
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
