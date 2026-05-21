-- =============================================================================
-- Saldo historico pre-Omie por socio.
--
-- Algumas empresas possuem historico de dividendos e aportes pagos antes da
-- migracao para a Omie. No sistema antigo esses valores eram registrados por
-- empresa e por socio. Para que as linhas "Dividendos Acumulados" e "Aportes
-- Acumulados" da tela Fluxo de Caixa (secao Acumulados) fiquem corretas
-- desde o inicio, o admin precisa poder digitar manualmente esses saldos
-- historicos por socio.
--
-- Modelo:
--   1. Duas colunas numericas opcionais em company_partners:
--        historical_dividends_value  -- saldo pre-Omie de dividendos pagos
--        historical_aportes_value    -- saldo pre-Omie de aportes recebidos
--      Default 0 / NOT NULL — campos opcionais sao representados por 0,
--      que e neutro no acumulado (nao desenha linha extra).
--
--   2. RPC cash_flow_partner_first_omie_month(p_company_id):
--      Retorna o primeiro mes com lancamento Omie partner-linked para
--      cada conta (4.2 e 5.1) da empresa. Usado pela tela Fluxo de Caixa
--      para calcular em qual mes o saldo historico deve ser exibido —
--      regra do produto: "mes anterior ao primeiro mes Omie".
--
-- Regras de uso (implementadas no app layer, NAO no SQL):
--   - O saldo historico NAO altera as linhas normais 4.2/5.1 do fluxo, nem o
--     valor "acumulado" daquela coluna no grid normal. Entra apenas no
--     accumulator da secao "Acumulados".
--   - O saldo historico aparece na linha do respectivo socio no mes anterior
--     ao primeiro lancamento Omie daquela empresa para aquela conta. A partir
--     dali soma normalmente ao acumulado vindo da Omie.
--   - Se historical_*_value = 0, comportamento atual e preservado.
--   - O totalizador da linha acumulada continua sendo soma dos socios quando
--     ha socios exibidos — historico entra automaticamente nesta soma.
-- =============================================================================

ALTER TABLE public.company_partners
  ADD COLUMN IF NOT EXISTS historical_dividends_value numeric NOT NULL DEFAULT 0
    CHECK (historical_dividends_value >= 0),
  ADD COLUMN IF NOT EXISTS historical_aportes_value numeric NOT NULL DEFAULT 0
    CHECK (historical_aportes_value >= 0);

COMMENT ON COLUMN public.company_partners.historical_dividends_value IS
  'Saldo de dividendos pagos a este socio ANTES da migracao para a Omie. '
  'Usado apenas na secao "Acumulados" do Fluxo de Caixa.';
COMMENT ON COLUMN public.company_partners.historical_aportes_value IS
  'Saldo de aportes recebidos deste socio ANTES da migracao para a Omie. '
  'Usado apenas na secao "Acumulados" do Fluxo de Caixa.';

-- Primeiro mes Omie com lancamento partner-linked para cada conta (4.2 / 5.1)
-- da empresa. Espelha os filtros de cash_flow_partner_breakdown
-- (mapeamento + JOIN com supplier_links + filtro de departamentos), de modo
-- que o resultado seja consistente com o que o usuario ve no grid.
--
-- Retorna 0..N linhas (uma por conta com pelo menos 1 lancamento). Se uma
-- conta nao tem nenhum lancamento partner-linked, simplesmente nao aparece
-- no resultado — o chamador trata como "sem dado Omie".
CREATE OR REPLACE FUNCTION public.cash_flow_partner_first_omie_month(
  p_company_id uuid
)
RETURNS TABLE (
  cash_flow_account_id uuid,
  first_year integer,
  first_month integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    mapping.cash_flow_account_id,
    extract(year from min(fe.payment_date))::integer AS first_year,
    extract(month from min(fe.payment_date))::integer AS first_month
  FROM public.financial_entries fe
  JOIN public.companies c ON c.id = fe.company_id
  JOIN public.company_partner_supplier_links link
    ON link.company_id = fe.company_id
    AND link.supplier_customer = fe.supplier_customer
  CROSS JOIN LATERAL (
    SELECT cm.cash_flow_account_id
    FROM public.cash_flow_category_mappings cm
    WHERE cm.omie_category_code = fe.category_code
      AND (cm.company_id = fe.company_id OR cm.company_id IS NULL)
    ORDER BY cm.company_id NULLS LAST
    LIMIT 1
  ) mapping
  WHERE fe.company_id = p_company_id
    AND fe.payment_date IS NOT NULL
    AND fe.category_code IS NOT NULL
    AND mapping.cash_flow_account_id IN (
      SELECT id
      FROM public.cash_flow_accounts
      WHERE code IN ('4.2', '5.1')
        AND active = true
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
  GROUP BY mapping.cash_flow_account_id;
$$;

GRANT EXECUTE ON FUNCTION public.cash_flow_partner_first_omie_month(uuid) TO authenticated;
