-- =============================================================================
-- Armazenamento de valores FEE e VVR por mes para empresas do segmento
-- Franquias Viva. Tabela puramente para registro manual — NAO interfere em
-- nenhum calculo da DRE, Fluxo de Caixa, KPIs, Orcamento ou demais modulos.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.company_fee_vvr (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  fee numeric,
  vvr numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (company_id, year, month)
);

CREATE INDEX IF NOT EXISTS company_fee_vvr_company_idx
  ON public.company_fee_vvr (company_id, year, month);

-- updated_at automatico via trigger.
CREATE OR REPLACE FUNCTION public.company_fee_vvr_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_fee_vvr_touch_updated_at_trg ON public.company_fee_vvr;
CREATE TRIGGER company_fee_vvr_touch_updated_at_trg
BEFORE UPDATE ON public.company_fee_vvr
FOR EACH ROW EXECUTE FUNCTION public.company_fee_vvr_touch_updated_at();

-- ─── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.company_fee_vvr ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read company_fee_vvr by permission"
ON public.company_fee_vvr
FOR SELECT
TO authenticated
USING (
  public.is_admin()
  OR public.is_hero_manager()
  OR company_id IN (
    SELECT u.company_id
    FROM public.users u
    WHERE u.id = auth.uid()
  )
);

CREATE POLICY "Write company_fee_vvr admin"
ON public.company_fee_vvr
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());
