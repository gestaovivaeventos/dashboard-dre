-- Contratante como aparece no PDF do contrato, quando difere do cadastro do
-- cliente. NULL = o PDF usa o cadastro (comportamento anterior). Usado só no
-- PDF: Omie, projeto, observação e assinatura continuam lendo case_clients.
ALTER TABLE public.case_contracts ADD COLUMN IF NOT EXISTS pdf_cliente jsonb;
