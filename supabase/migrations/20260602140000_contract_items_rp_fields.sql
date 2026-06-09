-- Campos da Requisição de Pagamento importados da planilha de upload, usados
-- pelas regras de cronograma por módulo, BV (saldo do contrato) e vencimento
-- (etapas 4/5). São opcionais: planilha sem essas colunas continua funcionando.
ALTER TABLE public.contract_validation_items
  ADD COLUMN IF NOT EXISTS data_evento text,
  ADD COLUMN IF NOT EXISTS modulo integer,
  ADD COLUMN IF NOT EXISTS valor_total_contrato numeric(15,2),
  ADD COLUMN IF NOT EXISTS historico_rps_pagas numeric(15,2),
  ADD COLUMN IF NOT EXISTS data_pagamento_prevista text;
