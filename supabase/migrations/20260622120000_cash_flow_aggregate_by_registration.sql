-- ============================================================================
-- RPC: cash_flow_aggregate_by_registration
-- ============================================================================
-- Agrega financial_entries por MÊS DA DATA DE REGISTRO (Omie "dDtRegistro"),
-- e NÃO pela data de pagamento. Usada EXCLUSIVAMENTE pela seção gerencial
-- "Custódia de Artistas - Análise Competência" da Case Shows.
--
-- Espelha o de/para de categorias da public.cash_flow_aggregate_live (união
-- routed_cash_flow_category_mapping + cash_flow_category_mappings, mesma
-- prioridade de escopo, mesmo strip do prefixo __fundos_*, mesma guarda de
-- rateio por departamento), com TRÊS diferenças:
--   1. O período vem da DATA DE REGISTRO lida do raw_json. Na ListarMovimentos
--      o filtro "data de registro" é dDtRegDe/dDtRegAte, e no payload de
--      RESPOSTA esse campo é `dDtInc` (data de inclusão = registro na Omie);
--      NÃO existe "dDtRegistro" na resposta. Lido de `detalhes.dDtInc` (fallback
--      na raiz), formato "DD/MM/YYYY". Em vez de fe.payment_date.
--   2. Retorna quebrado por (period_year, period_month) — UMA chamada cobre
--      todos os meses exibidos.
--   3. PERFORMANCE: recebe p_category_codes (os códigos Omie das categorias da
--      Custódia) e pré-filtra financial_entries por empresa + categoria ANTES
--      de tocar o raw_json. A extração de JSON (cara) só roda nas poucas linhas
--      candidatas, evitando o statement timeout que ocorria ao varrer todo o
--      histórico da empresa extraindo a data de registro linha a linha.
--
-- NÃO altera nenhuma RPC existente, nenhum dado da Omie, nem o pipeline de
-- sync. Função de LEITURA, aditiva e isolada. Piso de 2026 e saldo corrido
-- ficam na camada de aplicação (fluxo-de-caixa/page.tsx).

DROP FUNCTION IF EXISTS public.cash_flow_aggregate_by_registration(uuid[], date, date);

CREATE OR REPLACE FUNCTION public.cash_flow_aggregate_by_registration(
  p_company_ids uuid[],
  p_date_from date,
  p_date_to date,
  p_category_codes text[]
)
RETURNS TABLE (
  period_year integer,
  period_month integer,
  cash_flow_account_id uuid,
  amount numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH candidate AS (
    -- Pré-filtro barato: empresa + categoria da Custódia. Só aqui extraímos a
    -- data de registro do raw_json (caro), num conjunto já pequeno.
    SELECT
      fe.value AS value,
      fe.company_id AS company_id,
      fe.category_code AS category_code,
      fe.department_code AS department_code,
      CASE
        WHEN COALESCE(fe.raw_json->'detalhes'->>'dDtInc', fe.raw_json->>'dDtInc')
             ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
        THEN to_date(
          COALESCE(fe.raw_json->'detalhes'->>'dDtInc', fe.raw_json->>'dDtInc'),
          'DD/MM/YYYY')
        ELSE NULL
      END AS registro_date
    FROM public.financial_entries fe
    WHERE fe.company_id = ANY(p_company_ids)
      AND fe.category_code IS NOT NULL
      AND regexp_replace(fe.category_code, '^__fundos_(rec|desp)_', '') = ANY(p_category_codes)
  ),
  filtered AS (
    SELECT * FROM candidate
    WHERE registro_date IS NOT NULL
      AND registro_date BETWEEN p_date_from AND p_date_to
  )
  SELECT
    EXTRACT(YEAR FROM fe.registro_date)::int AS period_year,
    EXTRACT(MONTH FROM fe.registro_date)::int AS period_month,
    mapping.cash_flow_account_id,
    sum(fe.value)::numeric AS amount
  FROM filtered fe
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
  WHERE COALESCE(route.routed_to_company_id, fe.company_id) = ANY(p_company_ids)
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
  GROUP BY 1, 2, mapping.cash_flow_account_id;
$$;

GRANT EXECUTE ON FUNCTION public.cash_flow_aggregate_by_registration(uuid[], date, date, text[]) TO authenticated;
