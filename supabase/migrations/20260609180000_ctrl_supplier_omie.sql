-- Flag: fornecedor participa do sync com o Omie. Existentes (legados) ficam
-- false (isentos); createSupplier/updateSupplier passam a gravar true.
ALTER TABLE ctrl_suppliers
  ADD COLUMN IF NOT EXISTS omie_sync_required boolean NOT NULL DEFAULT false;

-- Mapa fornecedor × unidade (company) × resultado do cadastro no Omie.
CREATE TABLE IF NOT EXISTS ctrl_supplier_omie_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES ctrl_suppliers(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id),
  omie_codigo_cliente bigint,
  sync_status text NOT NULL DEFAULT 'pendente'
    CHECK (sync_status IN ('pendente','ok','erro')),
  sync_error text,
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, company_id)
);

CREATE INDEX IF NOT EXISTS ctrl_supplier_omie_links_supplier_idx
  ON ctrl_supplier_omie_links(supplier_id);

ALTER TABLE ctrl_supplier_omie_links ENABLE ROW LEVEL SECURITY;

-- Acesso via client de sessão para papéis de aprovação. As server actions
-- escrevem via service-role (bypassa RLS), mas a policy garante leitura segura.
CREATE POLICY ctrl_supplier_omie_links_rw ON ctrl_supplier_omie_links
  FOR ALL
  USING (has_ctrl_role(ARRAY['admin','csc','aprovacao_fornecedor','contas_a_pagar']))
  WITH CHECK (has_ctrl_role(ARRAY['admin','csc','aprovacao_fornecedor','contas_a_pagar']));
