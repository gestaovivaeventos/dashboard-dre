-- Planejamento dos sócios: novo status 'proposto' (proposta da IA gravada na hora,
-- antes de o admin finalizar em 'concluido'). O CHECK antigo só aceitava
-- rascunho/concluido e barrava a gravação automática da proposta.
ALTER TABLE public.orcamento_planejamento_socios
  DROP CONSTRAINT IF EXISTS orcamento_planejamento_socios_status_chk;

ALTER TABLE public.orcamento_planejamento_socios
  ADD CONSTRAINT orcamento_planejamento_socios_status_chk
  CHECK (status IN ('rascunho', 'proposto', 'concluido'));

NOTIFY pgrst, 'reload schema';
