-- Status "Pago" das requisições: reflete o pagamento REAL (baixa) no Omie.
--
-- A requisição continua com status = 'agendado' (Enviado Pgto) depois de
-- lançada no Omie. Este campo marca QUANDO o título foi de fato PAGO (baixado)
-- no Omie — não apenas enviado/programado. O preenchimento é feito pela
-- reconciliação (cron sync-all + botão "Atualizar pagamentos"), que consulta o
-- status_titulo/baixa de cada título via ListarContasPagar. Enquanto NULL, a
-- requisição segue exibida como "Enviado Pgto"; preenchido, exibe "Pago".
ALTER TABLE public.ctrl_requests
  ADD COLUMN IF NOT EXISTS omie_paid_at TIMESTAMPTZ;

COMMENT ON COLUMN public.ctrl_requests.omie_paid_at IS
  'Data/hora em que o título foi efetivamente PAGO (baixado) no Omie. NULL = ainda não pago (só enviado/agendado). Preenchido pela reconciliação de pagamentos.';

-- Índice parcial para a reconciliação varrer só os títulos ainda não pagos.
CREATE INDEX IF NOT EXISTS ctrl_requests_unpaid_launched_idx
  ON public.ctrl_requests (paying_company_id)
  WHERE omie_paid_at IS NULL AND omie_contapagar_codigo IS NOT NULL;
