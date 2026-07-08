-- Contrato cliente (modelo CASE Shows): item livre de extras + bloco RIDER E AFINS.
ALTER TABLE public.case_contracts
  ADD COLUMN extra_outros text,
  ADD COLUMN rider_tecnico boolean NOT NULL DEFAULT false,
  ADD COLUMN rider_camarim boolean NOT NULL DEFAULT false,
  ADD COLUMN rider_pre_producao boolean NOT NULL DEFAULT false;
