-- =============================================================================
-- Módulo Orçamento — empresa dos ENCARGOS de cada colaborador.
--
-- Um colaborador pode estar registrado numa empresa do grupo e ser orçado em
-- outra: o custo entra no orçamento da empresa filtrada na tela, mas os
-- encargos sobre a folha dele seguem o REGIME TRIBUTÁRIO da empresa em que ele
-- é registrado. Duas pessoas no mesmo quadro podem, portanto, ter alíquotas
-- diferentes — uma no Lucro Presumido (INSS + RAT + terceiros + FGTS) e outra
-- no Simples Nacional (só FGTS).
--
-- NULL = usa a própria empresa do quadro, que é o comportamento atual e
-- continua sendo o padrão.
--
-- Só afeta o CÁLCULO dos encargos. O valor sempre compõe o orçamento da empresa
-- do quadro (company_id) — esta coluna não muda o destino de nada.
-- Idempotente (ADD COLUMN IF NOT EXISTS).
-- =============================================================================

ALTER TABLE public.orcamento_pessoal_colaboradores
  ADD COLUMN IF NOT EXISTS empresa_encargos_id uuid
    REFERENCES public.companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS orcamento_pessoal_colab_empresa_encargos_idx
  ON public.orcamento_pessoal_colaboradores (empresa_encargos_id);
