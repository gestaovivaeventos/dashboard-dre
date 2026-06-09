-- Lançamento da requisição no Omie (contas a pagar) por empresa pagadora.
ALTER TABLE ctrl_requests
  ADD COLUMN IF NOT EXISTS paying_company_id uuid REFERENCES companies(id),
  ADD COLUMN IF NOT EXISTS omie_launch_status text
    CHECK (omie_launch_status IN ('pendente','recebido','lancado','erro')),
  ADD COLUMN IF NOT EXISTS omie_contapagar_codigo bigint,
  ADD COLUMN IF NOT EXISTS omie_launch_error text,
  ADD COLUMN IF NOT EXISTS omie_launched_at timestamptz;
