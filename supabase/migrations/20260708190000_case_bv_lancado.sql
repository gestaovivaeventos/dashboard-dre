-- Apuração de BV: registrado quando o BV (recebido − saídas) é lançado no Omie
-- via rateio de categoria nos títulos a receber.
ALTER TABLE public.case_contracts
  ADD COLUMN bv_lancado_valor numeric(15,2),
  ADD COLUMN bv_lancado_at timestamptz;
