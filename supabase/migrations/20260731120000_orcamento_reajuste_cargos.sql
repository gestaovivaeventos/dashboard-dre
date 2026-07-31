-- =============================================================================
-- Módulo Orçamento — reajuste salarial do Plano de Cargos, por empresa × ano.
--
-- O reajuste anual é um percentual aplicado a todos os níveis do plano de UMA
-- empresa num ano. Para que ele seja REVERSÍVEL e NÃO COMPOSTO, duas peças:
--
--   • orcamento_company_config.reajuste_cargos_percent
--       o percentual em vigor (0 ou NULL = nenhum reajuste aplicado).
--
--   • orcamento_cargo_niveis.salario_original
--       o salário-base ANTES do reajuste. Preenchido no momento em que um
--       reajuste é aplicado; NULL enquanto não há reajuste.
--
-- Com isso, aplicar um novo percentual sempre recalcula a partir de
-- salario_original — trocar 5% por 8% dá 8% sobre a base, não 8% sobre os 5%.
-- Zerar devolve salario = salario_original e limpa a coluna.
--
-- A coluna `salario` continua sendo o valor EFETIVO em uso: nada mais no app
-- precisa saber que existe reajuste.
-- Idempotente (ADD COLUMN IF NOT EXISTS).
-- =============================================================================

ALTER TABLE public.orcamento_company_config
  ADD COLUMN IF NOT EXISTS reajuste_cargos_percent numeric;

ALTER TABLE public.orcamento_cargo_niveis
  ADD COLUMN IF NOT EXISTS salario_original numeric;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orcamento_cargo_niveis_salario_original_check'
  ) THEN
    ALTER TABLE public.orcamento_cargo_niveis
      ADD CONSTRAINT orcamento_cargo_niveis_salario_original_check
      CHECK (salario_original IS NULL OR salario_original >= 0);
  END IF;
END $$;
