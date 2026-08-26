-- Planejamento dos sócios: separa a BASE (Etapa 1, o que a IA considera) da
-- PROPOSTA (Etapa 3, saída da entrevista). Antes a mesma tabela de itens servia
-- às duas coisas, então a "Proposta" espelhava a base mesmo sem entrevista.
--
--  base_salva            -> Etapa 1 finalizada pelo admin (habilita a entrevista)
--  proposta (jsonb)      -> Etapa 3: itens finais vindos da entrevista {itens, justificativa}
--  proposta_confirmada   -> gestor confirmou -> congela; só admin altera
--
-- Os itens da BASE continuam em orcamento_planejamento_socios_itens.
ALTER TABLE public.orcamento_planejamento_socios
  ADD COLUMN IF NOT EXISTS base_salva boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS proposta jsonb,
  ADD COLUMN IF NOT EXISTS proposta_confirmada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS proposta_confirmada_em timestamptz,
  ADD COLUMN IF NOT EXISTS proposta_confirmada_por uuid;

NOTIFY pgrst, 'reload schema';
