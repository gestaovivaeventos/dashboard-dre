-- Verba Rider/Camarim: reserva do contrato paga a fornecedores; saldo pode
-- ser convertido em BV. Fornecedores usam o cadastro case_bands (kind).
ALTER TABLE public.case_bands
  ADD COLUMN kind text NOT NULL DEFAULT 'atracao' CHECK (kind IN ('atracao', 'fornecedor'));

ALTER TABLE public.case_contracts
  ADD COLUMN valor_rider_camarim numeric(15,2) NOT NULL DEFAULT 0;

CREATE TABLE public.case_contract_fornecedores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.case_contracts(id) ON DELETE CASCADE,
  band_id uuid NOT NULL REFERENCES public.case_bands(id),
  descricao text,
  attachment_path text,
  valor numeric(15,2) NOT NULL DEFAULT 0,
  pagar_schedule jsonb,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX case_contract_fornecedores_contract_idx
  ON public.case_contract_fornecedores(contract_id);
ALTER TABLE public.case_contract_fornecedores ENABLE ROW LEVEL SECURITY;
CREATE POLICY case_contract_fornecedores_rw ON public.case_contract_fornecedores
  FOR ALL USING (public.has_case_access()) WITH CHECK (public.has_case_access());

ALTER TABLE public.case_titles
  ADD COLUMN fornecedor_id uuid REFERENCES public.case_contract_fornecedores(id) ON DELETE SET NULL;
