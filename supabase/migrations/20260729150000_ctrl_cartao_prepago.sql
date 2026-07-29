-- Novo método de pagamento "Cartão Pré-Pago" (ex.: cartão pré-pago cadastrado no
-- Omie como conta corrente do tipo Cartão de Crédito). Convive com o "Cartão de
-- Crédito" normal; a diferença é a conta corrente Omie de destino, mapeada por
-- empresa. Pré-pago não tem fatura, então usa vencimento normal (não o dia 05).

-- 1) Aceita o novo método no CHECK do payment_method.
ALTER TABLE public.ctrl_requests DROP CONSTRAINT IF EXISTS ctrl_requests_payment_method_check;
ALTER TABLE public.ctrl_requests
  ADD CONSTRAINT ctrl_requests_payment_method_check
  CHECK (payment_method IN (
    'boleto','pix','transferencia','cartao_credito','dinheiro','pix_copia_cola','cartao_prepago'
  ));

-- 2) Slot de mapeamento: conta corrente Omie usada quando o método é pré-pago.
ALTER TABLE public.ctrl_company_omie_config
  ADD COLUMN IF NOT EXISTS codigo_conta_corrente_cartao_prepago text;

COMMENT ON COLUMN public.ctrl_company_omie_config.codigo_conta_corrente_cartao_prepago IS
  'Conta corrente Omie (nCodCC) usada quando o método de pagamento é cartão pré-pago.';
