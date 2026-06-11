-- Documentos anexos por empresa. Cada documento pertence a UMA empresa e nunca
-- aparece para outra (filtro sempre por company_id).
--
-- Upload/exclusao: admin (server-side via service-role, bypassa RLS).
-- Leitura: admin, gestor_hero ou usuario com acesso a empresa
-- (user_company_access) — mesma regra de visibilidade do dashboard/BI.
-- As policies abaixo sao defesa em profundidade: a autorizacao fina tambem e
-- feita na API (resolveAllowedCompanyIds), espelhando o padrao das demais telas.

CREATE TABLE IF NOT EXISTS public.company_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_type text,
  storage_path text NOT NULL,
  size_bytes bigint,
  uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  uploaded_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_documents_company_idx
  ON public.company_documents(company_id, created_at DESC);

ALTER TABLE public.company_documents ENABLE ROW LEVEL SECURITY;

-- Leitura: admin / gestor_hero / quem tem acesso a empresa.
DROP POLICY IF EXISTS "Read company_documents by access" ON public.company_documents;
CREATE POLICY "Read company_documents by access"
ON public.company_documents
FOR SELECT
TO authenticated
USING (
  public.is_admin()
  OR public.is_hero_manager()
  OR public.user_has_company_access(company_id)
);

-- Escrita (upload/exclusao): admin apenas.
DROP POLICY IF EXISTS "Write company_documents admin" ON public.company_documents;
CREATE POLICY "Write company_documents admin"
ON public.company_documents
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Bucket privado de armazenamento dos arquivos. Idempotente.
-- Mantido privado: todo acesso passa por URL assinada gerada no backend apos
-- a validacao de permissao por empresa.
INSERT INTO storage.buckets (id, name, public)
VALUES ('company-documents', 'company-documents', false)
ON CONFLICT (id) DO NOTHING;
