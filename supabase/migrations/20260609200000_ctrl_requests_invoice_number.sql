-- Número da nota fiscal da requisição, lido automaticamente do anexo (NF-e)
-- ou preenchido manualmente.
ALTER TABLE ctrl_requests
  ADD COLUMN IF NOT EXISTS invoice_number text;
