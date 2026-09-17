-- BV artístico: comissão que a Case recebe do ARTISTA que indicou. Não há
-- contrato de venda, nem cliente, nem conta a pagar — o único lançamento é uma
-- conta a receber do artista, no valor da comissão (digitado à mão, porque o
-- contrato anexado quase nunca traz esse valor).
ALTER TABLE public.case_contracts
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'show';

DO $$ BEGIN
  ALTER TABLE public.case_contracts
    ADD CONSTRAINT case_contracts_kind_chk CHECK (kind IN ('show', 'bv_artistico'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- No BV quem paga é o artista (band_id); não existe contratante.
ALTER TABLE public.case_contracts ALTER COLUMN client_id DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE public.case_contracts
    ADD CONSTRAINT case_contracts_client_por_tipo_chk
    CHECK (kind <> 'show' OR client_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.case_contracts
    ADD CONSTRAINT case_contracts_bv_band_chk
    CHECK (kind <> 'bv_artistico' OR band_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS case_contracts_kind_idx ON public.case_contracts(kind);
