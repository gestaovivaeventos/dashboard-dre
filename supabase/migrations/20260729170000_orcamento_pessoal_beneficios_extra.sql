-- =============================================================================
-- Módulo Orçamento — benefícios adicionais do quadro de pessoal.
--
-- Além dos já existentes, o orçamento usa mais dois benefícios MENSAIS por
-- colaborador:
--   • refeicoes_empresa  — refeições na empresa (todos os vínculos).
--   • seguro_vida        — seguro de vida; na tela, a célula só é habilitada
--                          quando o vínculo é "Estágio" (regra de UI). Coluna
--                          anulável, como as demais.
--
-- (Auxílio home office já existe desde a migration 20260729160000.)
-- Idempotente (ADD COLUMN IF NOT EXISTS).
-- =============================================================================

ALTER TABLE public.orcamento_pessoal_colaboradores
  ADD COLUMN IF NOT EXISTS refeicoes_empresa numeric
    CHECK (refeicoes_empresa IS NULL OR refeicoes_empresa >= 0),
  ADD COLUMN IF NOT EXISTS seguro_vida numeric
    CHECK (seguro_vida IS NULL OR seguro_vida >= 0);
