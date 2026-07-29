-- =============================================================================
-- Módulo Orçamento — índices de correção adicionais.
--
-- Além de IPCA, IGP-M e salário mínimo, o orçamento usa outros índices de
-- reajuste: IST (telecom), Aneel (energia), INPC e ANS (planos de saúde). Todos
-- são percentuais anuais e seguem o mesmo modelo dos existentes: NACIONAIS
-- (mesmos p/ todas as empresas), um valor por ANO, congelados no tempo.
--
-- Colunas anuláveis: um ano pode ter só parte dos índices conhecidos.
-- Idempotente (ADD COLUMN IF NOT EXISTS).
-- =============================================================================

ALTER TABLE public.orcamento_indices
  ADD COLUMN IF NOT EXISTS ist   numeric,
  ADD COLUMN IF NOT EXISTS aneel numeric,
  ADD COLUMN IF NOT EXISTS inpc  numeric,
  ADD COLUMN IF NOT EXISTS ans   numeric;
