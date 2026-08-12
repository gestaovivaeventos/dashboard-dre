-- Tipo de pagamento da RP (ex.: "Reembolso"), vindo da planilha de requisições.
-- Usado pela validação: quando os anexos são comprovantes de reembolso e a RP
-- está marcada como reembolso, favorecido divergente não reprova (a origem do
-- comprovante pode ser terceiro); sem a marcação, vai para análise especialista.
ALTER TABLE public.contract_validation_items
  ADD COLUMN IF NOT EXISTS tipo_pagamento text;
