-- supabase/migrations/20260910130000_vb_omie_triage.sql
-- Triagem dos pagamentos da ABD Holding (financial_entries) no VB.
-- Uma decisão por movimento da Omie. Pendente não é gravado: é candidato sem
-- linha aqui. Guarda o retrato do pagamento porque o sync apaga movimentos
-- que somem da Omie (cleanup_obsolete_entries) e a decisão precisa sobreviver.
CREATE TABLE IF NOT EXISTS public.vb_omie_triage (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  omie_id            TEXT NOT NULL,
  financial_entry_id UUID NULL REFERENCES public.financial_entries(id) ON DELETE SET NULL,
  status             TEXT NOT NULL CHECK (status IN ('vinculado', 'descartado')),
  -- Vinculado: grupo dos lançamentos criados (vb_entries.group_id).
  group_id           UUID NULL,
  payment_date       DATE NOT NULL,
  supplier_customer  TEXT NULL,
  description        TEXT NULL,
  category_code      TEXT NULL,
  category_name      TEXT NULL,
  value              NUMERIC(14,2) NOT NULL,
  decided_by         UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vb_omie_triage_one_decision UNIQUE (company_id, omie_id),
  CONSTRAINT vb_omie_triage_linked_has_group CHECK (status <> 'vinculado' OR group_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS vb_omie_triage_group_idx
  ON public.vb_omie_triage (group_id) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vb_omie_triage_supplier_idx
  ON public.vb_omie_triage (company_id, supplier_customer, decided_at DESC);

DROP TRIGGER IF EXISTS vb_omie_triage_touch_updated_at ON public.vb_omie_triage;
CREATE TRIGGER vb_omie_triage_touch_updated_at
  BEFORE UPDATE ON public.vb_omie_triage
  FOR EACH ROW EXECUTE FUNCTION public.vb_touch_updated_at();

ALTER TABLE public.vb_omie_triage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vb_omie_triage_select ON public.vb_omie_triage;
CREATE POLICY vb_omie_triage_select ON public.vb_omie_triage
  FOR SELECT TO authenticated USING (public.vb_role() = 'gestor');
-- Sem policy de escrita: só o service role grava (actions depois de requireVbGestor()).

COMMENT ON TABLE public.vb_omie_triage IS
  'Decisão do gestor do VB sobre cada pagamento da ABD Holding vindo da Omie: descartado ou vinculado (group_id dos lançamentos).';
