-- Datas de vencimento das parcelas extraídas do documento (array de strings
-- DD/MM/AAAA), espelhando extracted_pagamentos. Usadas na regra de vencimento:
-- vencimento do documento posterior à data prevista de pagamento → ressalva.
ALTER TABLE public.contract_validation_items
  ADD COLUMN IF NOT EXISTS extracted_vencimentos jsonb;
