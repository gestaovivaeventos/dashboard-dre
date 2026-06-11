-- Anexo da nota fiscal, independente do anexo de pagamento (boleto/comprovante).
-- Permite uma requisição de boleto ter também a NF anexada.
ALTER TABLE ctrl_requests
  ADD COLUMN IF NOT EXISTS invoice_attachment_path text;
