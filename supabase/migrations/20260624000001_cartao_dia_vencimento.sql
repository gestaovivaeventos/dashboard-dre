-- Dia de vencimento da fatura do cartao de credito por empresa.
-- Usado no envio para pagamento (contapagar-launch) para datar o vencimento
-- de pagamentos no cartao no dia configurado, respeitando a regra de fechamento
-- (compra a partir do dia 23 -> primeira parcela +2 meses; senao +1).
ALTER TABLE ctrl_company_omie_config
  ADD COLUMN IF NOT EXISTS cartao_dia_vencimento smallint
  CHECK (cartao_dia_vencimento BETWEEN 1 AND 31);

COMMENT ON COLUMN ctrl_company_omie_config.cartao_dia_vencimento IS
  'Dia do mes (1-31) de vencimento da fatura do cartao de credito da empresa.';
