-- =============================================================================
-- Módulo Orçamento — regime de apuração (caixa x competência) por empresa/ano.
--
-- Define como as provisões da folha são distribuídas nos 12 meses do orçamento:
--   • caixa       → 13º metade em novembro, metade em dezembro (quando é pago).
--   • competência → 13º diluído em 1/12 por mês.
-- (Férias são diluídas nos 12 meses nos dois regimes.)
--
-- Fica em orcamento_company_config, e não em companies, porque é premissa do
-- ORÇAMENTO daquele ano — como o orcar_por_setor, que já mora aqui. Ao clonar
-- um ano para o seguinte, a escolha é copiada junto.
--
-- Anulável: empresa/ano sem escolha assume 'caixa' na aplicação (padrão do
-- grupo, cuja DRE é regime de caixa).
-- Idempotente (ADD COLUMN IF NOT EXISTS + CHECK por descoberta).
-- =============================================================================

ALTER TABLE public.orcamento_company_config
  ADD COLUMN IF NOT EXISTS regime_apuracao text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orcamento_company_config_regime_apuracao_check'
  ) THEN
    ALTER TABLE public.orcamento_company_config
      ADD CONSTRAINT orcamento_company_config_regime_apuracao_check
      CHECK (regime_apuracao IS NULL OR regime_apuracao IN ('caixa', 'competencia'));
  END IF;
END $$;
