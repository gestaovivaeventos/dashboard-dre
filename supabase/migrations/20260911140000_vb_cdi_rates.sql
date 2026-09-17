-- supabase/migrations/20260911140000_vb_cdi_rates.sql
-- CDI diário do Banco Central (série 12 do SGS), um registro por dia útil.
-- Guardado em vez de consultado na hora para o cálculo ser reproduzível e
-- auditável, e para o dia em que o BCB estiver fora do ar não travar nada.
CREATE TABLE IF NOT EXISTS public.vb_cdi_rates (
  rate_date  DATE PRIMARY KEY,
  -- Percentual ao dia, como o BCB publica: 0.051660 = 0,05166% a.d.
  rate       NUMERIC(12,8) NOT NULL CHECK (rate >= 0),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.vb_cdi_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vb_cdi_rates_select ON public.vb_cdi_rates;
CREATE POLICY vb_cdi_rates_select ON public.vb_cdi_rates
  FOR SELECT TO authenticated USING (public.vb_role() IS NOT NULL);
-- Sem policy de escrita: só o service role grava.

COMMENT ON TABLE public.vb_cdi_rates IS
  'CDI diário (série 12 do SGS/BCB) usado para o rendimento automático do VB.';
