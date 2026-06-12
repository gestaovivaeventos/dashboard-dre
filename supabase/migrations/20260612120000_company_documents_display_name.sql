-- Nome de exibicao do documento, informado pelo admin no upload. E o nome
-- principal mostrado na listagem (mais claro/amigavel que o nome do arquivo).
-- Nullable: documentos antigos ficam sem display_name e a UI cai no fallback
-- do nome original do arquivo (file_name). O arquivo original segue salvo
-- normalmente em file_name/storage_path.
ALTER TABLE public.company_documents
  ADD COLUMN IF NOT EXISTS display_name text;
