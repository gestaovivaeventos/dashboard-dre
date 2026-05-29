-- =============================================================================
-- dashboard_dre_aggregate + by_company — incluir manual_account_values
-- =============================================================================
-- Reescreve as duas funcoes de agregacao do DRE para combinar duas fontes:
--   (a) financial_entries via category_mapping — para contas com
--       dre_accounts.data_source = 'omie' (default, mantem comportamento
--       atual de TODAS as contas pre-existentes);
--   (b) manual_account_values — para contas com data_source <> 'omie'
--       (tipicamente 'sheets' apos a migration de manual_account_values).
--
-- Por que UNION ALL + group by ao inves de COALESCE / preferencia:
-- queremos que contas marcadas como manuais IGNOREM completamente o
-- financial_entries (evita double-counting se alguem mapear no Omie por
-- engano). O JOIN com dre_accounts em cada lado garante o filtro por
-- data_source.
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
