-- =============================================================================
-- Módulo Orçamento — VALIDAÇÃO CONCLUÍDA POR TELA × SETOR.
--
-- Pedido do dono do projeto (26/09/2026): "deveria ser uma validação para cada
-- tela e setor". Concluir a validação era um ato único da empresa inteira, o que
-- não corresponde ao trabalho real — a diretoria fecha o Pessoal do Atendimento,
-- depois a Média do Financeiro, e assim por diante, muitas vezes em dias
-- diferentes e conversando com responsáveis diferentes.
--
-- Cada linha aqui é "a diretoria terminou de revisar ESTE método NESTE setor,
-- nesta rodada". Por rodada porque um reenvio recomeça a revisão: herdar o
-- fechamento da rodada anterior daria por revisado o que ninguém olhou.
--
-- `setor_chave` é texto e não uuid porque o setor pode ser nulo (linha sem
-- setor) e NULL não entra em PRIMARY KEY — o código grava o uuid ou '-'.
--
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.orcamento_validacoes_tela (
  ciclo_id uuid NOT NULL REFERENCES public.orcamento_ciclos(id) ON DELETE CASCADE,
  rodada integer NOT NULL,
  metodo text NOT NULL,
  setor_chave text NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  setor_id uuid REFERENCES public.orcamento_setores(id) ON DELETE SET NULL,
  concluido_em timestamptz NOT NULL DEFAULT now(),
  concluido_por uuid REFERENCES public.users(id) ON DELETE SET NULL,
  PRIMARY KEY (ciclo_id, rodada, metodo, setor_chave)
);

CREATE INDEX IF NOT EXISTS orcamento_validacoes_tela_empresa_idx
  ON public.orcamento_validacoes_tela (company_id, year);

ALTER TABLE public.orcamento_validacoes_tela ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orcamento_validacoes_tela admin all" ON public.orcamento_validacoes_tela;
CREATE POLICY "orcamento_validacoes_tela admin all" ON public.orcamento_validacoes_tela
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "orcamento_validacoes_tela orcamento read" ON public.orcamento_validacoes_tela;
CREATE POLICY "orcamento_validacoes_tela orcamento read" ON public.orcamento_validacoes_tela
  FOR SELECT TO authenticated USING (public.orcamento_pode_ler_empresa(company_id));

NOTIFY pgrst, 'reload schema';
