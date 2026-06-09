-- Data de assinatura/emissão do documento (string DD/MM/AAAA, igual a data_baile).
-- Extraída pelo LLM (etapa híbrida) para uso futuro no cronograma por módulo.
ALTER TABLE public.contract_validation_items
  ADD COLUMN IF NOT EXISTS data_contrato text;
