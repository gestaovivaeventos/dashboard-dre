-- =============================================================================
-- Filtros de data sargáveis nas RPCs de agregação (DRE e Fluxo de Caixa)
-- =============================================================================
--
-- PROBLEMA: as funções de agregação filtravam o período com
--   make_date(year, month, 1) BETWEEN date_trunc('month', p_date_from) AND ...
-- Envolver as colunas (year, month) em make_date() torna o predicado NÃO
-- sargável: o índice btree (company_id, year, month) só era usado para o
-- `company_id = ANY(...)`, e o intervalo de meses virava um Filter aplicado
-- linha a linha. Resultado (EXPLAIN ANALYZE, dashboard das 10 franquias, 1 mês):
--   Index Cond: company_id = ANY(...)
--   Filter: make_date(year,month,1) BETWEEN ...
--   Rows Removed by Filter: 13138        -- varre TODA a história das empresas
--   Buffers: shared hit=6646             -- ~52MB por chamada
-- A quente isso roda em ~11ms, mas o Dashboard dispara 13 dessas chamadas por
-- load (12 meses + acumulado, em Promise.all). Sob concorrência + cache frio o
-- custo estoura o statement_timeout (8s) e a página inteira cai com um 500
-- (server-side exception / digest), de forma recorrente.
--
-- CORREÇÃO: comparar a tupla (year, month) diretamente, que CASA com o índice
-- (company_id, year, month) e entra no Index Cond como range scan:
--   (year, month) >= (ano_de(p_date_from), mes_de(p_date_from))
--   (year, month) <= (ano_de(p_date_to),   mes_de(p_date_to))
-- Mesmo conjunto de linhas (a comparação de tupla trata virada de ano
-- corretamente — ao contrário de `month BETWEEN x AND y`). EXPLAIN da versão
-- nova: Buffers shared hit=168 (40x menos I/O), sem "Rows Removed by Filter".
-- Nenhuma mudança de resultado — apenas de plano de execução.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.dashboard_dre_aggregate(p_company_ids uuid[], p_date_from date, p_date_to date)
 RETURNS TABLE(dre_account_id uuid, amount numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH omie_amounts AS (
    SELECT dma.dre_account_id, sum(dma.amount)::numeric AS amount
    FROM public.dre_monthly_aggregates dma
    WHERE dma.company_id = ANY(p_company_ids)
      AND (dma.year, dma.month) >= (extract(year from p_date_from)::int, extract(month from p_date_from)::int)
      AND (dma.year, dma.month) <= (extract(year from p_date_to)::int,   extract(month from p_date_to)::int)
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
      AND (mav.ano, mav.mes) >= (extract(year from p_date_from)::int, extract(month from p_date_from)::int)
      AND (mav.ano, mav.mes) <= (extract(year from p_date_to)::int,   extract(month from p_date_to)::int)
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
$function$;

CREATE OR REPLACE FUNCTION public.dashboard_dre_aggregate_by_company(p_company_ids uuid[], p_date_from date, p_date_to date)
 RETURNS TABLE(company_id uuid, dre_account_id uuid, amount numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH omie_amounts AS (
    SELECT dma.company_id, dma.dre_account_id, sum(dma.amount)::numeric AS amount
    FROM public.dre_monthly_aggregates dma
    WHERE dma.company_id = ANY(p_company_ids)
      AND (dma.year, dma.month) >= (extract(year from p_date_from)::int, extract(month from p_date_from)::int)
      AND (dma.year, dma.month) <= (extract(year from p_date_to)::int,   extract(month from p_date_to)::int)
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
      AND (mav.ano, mav.mes) >= (extract(year from p_date_from)::int, extract(month from p_date_from)::int)
      AND (mav.ano, mav.mes) <= (extract(year from p_date_to)::int,   extract(month from p_date_to)::int)
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
$function$;

CREATE OR REPLACE FUNCTION public.cash_flow_aggregate(p_company_ids uuid[], p_date_from date, p_date_to date)
 RETURNS TABLE(cash_flow_account_id uuid, amount numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT cma.cash_flow_account_id, sum(cma.amount)::numeric AS amount
  FROM public.cash_flow_monthly_aggregates cma
  WHERE cma.company_id = ANY(p_company_ids)
    AND (cma.year, cma.month) >= (extract(year from p_date_from)::int, extract(month from p_date_from)::int)
    AND (cma.year, cma.month) <= (extract(year from p_date_to)::int,   extract(month from p_date_to)::int)
  GROUP BY cma.cash_flow_account_id;
$function$;

CREATE OR REPLACE FUNCTION public.cash_flow_aggregate_by_company(p_company_ids uuid[], p_date_from date, p_date_to date)
 RETURNS TABLE(company_id uuid, cash_flow_account_id uuid, amount numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT cma.company_id, cma.cash_flow_account_id, sum(cma.amount)::numeric AS amount
  FROM public.cash_flow_monthly_aggregates cma
  WHERE cma.company_id = ANY(p_company_ids)
    AND (cma.year, cma.month) >= (extract(year from p_date_from)::int, extract(month from p_date_from)::int)
    AND (cma.year, cma.month) <= (extract(year from p_date_to)::int,   extract(month from p_date_to)::int)
  GROUP BY cma.company_id, cma.cash_flow_account_id;
$function$;
