-- Cache das opções do Omie por empresa (categoria, departamento, conta corrente).
CREATE TABLE IF NOT EXISTS ctrl_omie_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('categoria','departamento','conta_corrente')),
  codigo text NOT NULL,
  descricao text,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, kind, codigo)
);
CREATE INDEX IF NOT EXISTS ctrl_omie_options_company_kind_idx ON ctrl_omie_options(company_id, kind);

-- Mapeamento tipo de despesa -> categoria Omie (por empresa).
CREATE TABLE IF NOT EXISTS ctrl_expense_type_omie_categoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_type_id uuid NOT NULL REFERENCES ctrl_expense_types(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  codigo_categoria text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (expense_type_id, company_id)
);

-- Mapeamento setor -> departamento Omie (por empresa).
CREATE TABLE IF NOT EXISTS ctrl_sector_omie_departamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sector_id uuid NOT NULL REFERENCES ctrl_sectors(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  codigo_departamento text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sector_id, company_id)
);

-- Conta corrente padrão (OmieCash) por empresa para o lançamento de contas a pagar.
CREATE TABLE IF NOT EXISTS ctrl_company_omie_config (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  codigo_conta_corrente text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ctrl_omie_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE ctrl_expense_type_omie_categoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE ctrl_sector_omie_departamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE ctrl_company_omie_config ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ctrl_omie_options','ctrl_expense_type_omie_categoria','ctrl_sector_omie_departamento','ctrl_company_omie_config']
  LOOP
    EXECUTE format($f$
      CREATE POLICY %1$s_rw ON %1$s FOR ALL
      USING (has_ctrl_role(ARRAY['admin','csc','contas_a_pagar']))
      WITH CHECK (has_ctrl_role(ARRAY['admin','csc','contas_a_pagar']));
    $f$, t);
  END LOOP;
END $$;
