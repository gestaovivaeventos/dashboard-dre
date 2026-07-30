-- =============================================================================
-- Regime tributário da empresa.
--
-- Atributo fiscal CADASTRAL (não versionado por ano, ao contrário do resto do
-- módulo Orçamento): a empresa é Simples Nacional, Lucro Presumido ou Lucro
-- Real. O orçamento de despesas com pessoal usa isto para escolher a regra de
-- encargos sobre a folha, que difere por regime.
--
-- Anulável: empresa sem regime definido ainda aparece normalmente nas telas; a
-- definição é feita em Painel Administrador → Configurações.
-- Idempotente (ADD COLUMN IF NOT EXISTS).
-- =============================================================================

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS regime_tributario text;

-- CHECK em passo separado para a migration continuar idempotente (ADD COLUMN
-- IF NOT EXISTS não recria a constraint quando a coluna já existe).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_regime_tributario_check'
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_regime_tributario_check
      CHECK (
        regime_tributario IS NULL
        OR regime_tributario IN ('simples_nacional', 'lucro_presumido', 'lucro_real')
      );
  END IF;
END $$;
