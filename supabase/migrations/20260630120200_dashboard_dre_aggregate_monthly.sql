-- =============================================================================
-- RPC: dashboard_dre_aggregate_monthly — agregação DRE por MÊS em uma chamada
-- =============================================================================
--
-- POR QUÊ: o Dashboard DRE disparava UMA chamada de dashboard_dre_aggregate por
-- mês visível + uma para o acumulado (13 round-trips concorrentes no "ano
-- atual"). Mesmo com o filtro sargável (cada chamada barata), 13 requisições
-- PostgREST simultâneas por load pressionam o pooler de conexões e, sob vários
-- usuários, geram fila/latência — fragilidade que ajudava a derrubar a página.
--
-- Esta função devolve os agregados de TODOS os meses do intervalo em UMA
-- chamada (year, month, dre_account_id, amount). O app monta os buckets mensais
-- e o acumulado a partir daí (somar meses == intervalo inteiro, pois as fórmulas
-- do DRE são lineares). Mesma lógica de origem de dados de
-- dashboard_dre_aggregate (Omie materializado + valores manuais + lançamentos
-- manuais mapeados), apenas agrupada também por (year, month). Filtros de data
-- sargáveis (comparação de tupla casa o índice (company_id, year, month)).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.dashboard_dre_aggregate_monthly(p_company_ids uuid[], p_date_from date, p_date_to date)
 RETURNS TABLE(year integer, month integer, dre_account_id uuid, amount numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH omie_amounts AS (
    SELECT dma.year, dma.month, dma.dre_account_id, sum(dma.amount)::numeric AS amount
    FROM public.dre_monthly_aggregates dma
    WHERE dma.company_id = ANY(p_company_ids)
      AND (dma.year, dma.month) >= (extract(year from p_date_from)::int, extract(month from p_date_from)::int)
      AND (dma.year, dma.month) <= (extract(year from p_date_to)::int,   extract(month from p_date_to)::int)
    GROUP BY dma.year, dma.month, dma.dre_account_id
  ),
  manual_amounts AS (
    SELECT
      mav.ano AS year,
      mav.mes AS month,
      mav.dre_account_id,
      sum(mav.valor)::numeric AS amount
    FROM public.manual_account_values mav
    JOIN public.dre_accounts da ON da.id = mav.dre_account_id
    WHERE mav.company_id = ANY(p_company_ids)
      AND da.data_source <> 'omie'
      AND (mav.ano, mav.mes) >= (extract(year from p_date_from)::int, extract(month from p_date_from)::int)
      AND (mav.ano, mav.mes) <= (extract(year from p_date_to)::int,   extract(month from p_date_to)::int)
    GROUP BY mav.ano, mav.mes, mav.dre_account_id
  ),
  manual_entry_amounts AS (
    SELECT
      extract(year from me.entry_date)::int  AS year,
      extract(month from me.entry_date)::int AS month,
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
    GROUP BY 1, 2, mapping.dre_account_id
  )
  SELECT year, month, dre_account_id, sum(amount)::numeric AS amount
  FROM (
    SELECT * FROM omie_amounts
    UNION ALL
    SELECT * FROM manual_amounts
    UNION ALL
    SELECT * FROM manual_entry_amounts
  ) combined
  GROUP BY year, month, dre_account_id;
$function$;

GRANT EXECUTE ON FUNCTION public.dashboard_dre_aggregate_monthly(uuid[], date, date) TO authenticated;
