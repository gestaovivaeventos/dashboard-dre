-- Fase A da repaginação do contrato Case em 3 etapas:
--  • case_titles.pago/pago_em/omie_status: status de pagamento espelhado do Omie
--    (ListarContasPagar/Receber) para a Etapa 3 (consolidação).
--  • case_contracts.receber_schedule: plano de parcelas a receber do cliente
--    capturado na Etapa 1. Os títulos (split custódia/serviços) só são gerados
--    na conclusão da Etapa 2, quando o valor do artista é conhecido.
ALTER TABLE public.case_titles
  ADD COLUMN IF NOT EXISTS pago        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pago_em     timestamptz,
  ADD COLUMN IF NOT EXISTS omie_status text;

ALTER TABLE public.case_contracts
  ADD COLUMN IF NOT EXISTS receber_schedule jsonb;
