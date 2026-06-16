-- Conta corrente específica por método de pagamento (dinheiro=caixa, cartão).
ALTER TABLE ctrl_company_omie_config
  ADD COLUMN IF NOT EXISTS codigo_conta_corrente_caixa  text,
  ADD COLUMN IF NOT EXISTS codigo_conta_corrente_cartao text;
