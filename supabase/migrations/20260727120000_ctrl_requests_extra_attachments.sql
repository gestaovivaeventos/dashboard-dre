-- Anexos diversos da requisição.
--
-- Além do boleto (attachment_path) e da nota fiscal (invoice_attachment_path),
-- o solicitante pode anexar documentos avulsos — contrato, cupom fiscal,
-- pedido, nota fiscal, etc. — em QUALQUER método de pagamento, pelo botão
-- "Adicionar anexos" na tela de cadastro de requisição.
--
-- Cada item é um object path no bucket 'ctrl-attachments'. No lançamento da
-- conta a pagar (contapagar-launch.ts), todos são anexados ao título no Omie,
-- junto com o boleto e a nota (best-effort).
--
-- Coluna opcional (default lista vazia; não afeta requisições existentes).

ALTER TABLE public.ctrl_requests
  ADD COLUMN IF NOT EXISTS extra_attachment_paths TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.ctrl_requests.extra_attachment_paths IS
  'Anexos diversos (contrato, cupom fiscal, pedido, nota, etc.) da requisição, cada item um object path no bucket ctrl-attachments. Enviados à Omie no lançamento da conta a pagar.';
