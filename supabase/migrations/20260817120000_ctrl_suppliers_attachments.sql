-- Anexos do cadastro de fornecedor.
--
-- Campo OPCIONAL: o usuário anexa o que julgar necessário no cadastro
-- (contrato social, cartão CNPJ, proposta, comprovante de conta bancária…).
-- Serve de apoio para quem homologa o fornecedor — não substitui nenhum campo
-- obrigatório e não é enviado à Omie.
--
-- Cada item é um object path no bucket 'ctrl-attachments' (o mesmo dos anexos
-- de requisição). A leitura gera URL assinada sob demanda
-- (getSupplierAttachments em lib/ctrl/actions/suppliers.ts).
--
-- Default lista vazia; não afeta os cadastros existentes.

ALTER TABLE public.ctrl_suppliers
  ADD COLUMN IF NOT EXISTS attachment_paths TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.ctrl_suppliers.attachment_paths IS
  'Anexos opcionais do cadastro do fornecedor (contrato social, cartão CNPJ, proposta, etc.), cada item um object path no bucket ctrl-attachments. Apoio à homologação; não vai para a Omie.';
