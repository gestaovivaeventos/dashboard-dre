-- ============================================================================
-- RPC: cash_flow_aggregate_by_registration
-- ============================================================================
-- Agrega financial_entries por MÊS DA DATA DE REGISTRO (Omie "dDtRegistro"),
-- e NÃO pela data de pagamento. Usada EXCLUSIVAMENTE pela seção gerencial
-- "Custódia de Artistas - Análise Competência" da Case Shows.
--
-- Espelha public.cash_flow_aggregate (mesmo mapeamento categoria→conta por
-- código, mesma prioridade de escopo, mesma guarda de rateio por departamento),
-- com DUAS diferenças:
--   1. O período é derivado da data de REGISTRO lida do raw_json (campo
--      Omie "dDtRegistro", formato "DD/MM/YYYY"), em vez de fe.payment_date.
--   2. Retorna o resultado quebrado por (period_year, period_month) para que
--      uma ÚNICA chamada cubra todos os meses exibidos (sem N RPCs por mês).
--
-- NÃO altera nenhuma RPC existente, nenhum dado da Omie, nem o pipeline de
-- sync. É uma função de LEITURA, aditiva e isolada. O piso de 2026 e o saldo
-- corrido são aplicados na camada de aplicação (fluxo-de-caixa/page.tsx).

CREATE OR REPLACE FUNCTION public.cash_flow_aggregate_by_registration(
  p_company_ids uuid[],
  p_date_from date,
  p_date_to date
)
RETURNS TABLE (
  period_year integer,
  period_month integer,
  cash_flow_account_id uuid,
  amount numeric
)
LANGUAGE sql
STABLE
AS $$
  WITH base AS (
    SELECT
      fe.value AS value,
      fe.company_id AS company_id,
      fe.category_code AS category_code,
      fe.department_code AS department_code,
      -- Data de registro vinda do raw_json: a Omie expõe "dDtRegistro" dentro
      -- de `detalhes` (com fallback para a raiz), no formato "DD/MM/YYYY".
      -- Valida o formato antes de converter para não quebrar em valores vazios
      -- ou inesperados (linhas sem data de registro são descartadas no WHERE).
      CASE
        WHEN COALESCE(fe.raw_json->'detalhes'->>'dDtRegistro', fe.raw_json->>'dDtRegistro')
             ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
        THEN to_date(
          COALESCE(fe.raw_json->'detalhes'->>'dDtRegistro', fe.raw_json->>'dDtRegistro'),
          'DD/MM/YYYY')
        ELSE NULL
      END AS registro_date
    FROM public.financial_entries fe
    WHERE fe.company_id = ANY(p_company_ids)
      AND fe.category_code IS NOT NULL
  )
  SELECT
    EXTRACT(YEAR FROM b.registro_date)::int AS period_year,
    EXTRACT(MONTH FROM b.registro_date)::int AS period_month,
    mapping.cash_flow_account_id,
    sum(b.value)::numeric AS amount
  FROM base b
  JOIN public.companies c ON c.id = b.company_id
  CROSS JOIN LATERAL (
    -- Mesmo de/para da cash_flow_aggregate: prioridade
    -- empresa+depto > empresa > global+depto > global.
    SELECT cm.cash_flow_account_id
    FROM public.cash_flow_category_mappings cm
    WHERE cm.omie_category_code = b.category_code
      AND (cm.company_id = b.company_id OR cm.company_id IS NULL)
      AND (cm.omie_department_code IS NULL
           OR cm.omie_department_code = b.department_code)
    ORDER BY
      (cm.company_id IS NOT NULL) DESC,
      (cm.omie_department_code IS NOT NULL) DESC
    LIMIT 1
  ) mapping
  WHERE b.registro_date IS NOT NULL
    AND b.registro_date BETWEEN p_date_from AND p_date_to
    AND (
      c.has_department_apportionment IS NOT TRUE
      OR EXISTS (
        SELECT 1
        FROM public.company_departments cd
        WHERE cd.company_id = b.company_id
          AND cd.included = true
          AND cd.omie_code = COALESCE(b.department_code, '__none__')
      )
    )
  GROUP BY 1, 2, mapping.cash_flow_account_id;
$$;

GRANT EXECUTE ON FUNCTION public.cash_flow_aggregate_by_registration(uuid[], date, date) TO authenticated;
