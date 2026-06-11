-- Data de referencia do documento (ex.: mes/ano a que o relatorio se refere),
-- preenchida pelo admin no upload. Independente de created_at (data do upload).
-- Nullable: documentos antigos ficam sem referencia ate serem reenviados.
ALTER TABLE public.company_documents
  ADD COLUMN IF NOT EXISTS reference_date date;
