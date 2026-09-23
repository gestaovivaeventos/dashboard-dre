-- =============================================================================
-- Módulo Orçamento — REVISÃO LINHA A LINHA pela diretoria.
--
-- Mudança de desenho (25/09/2026, depois do teste em tela): a validação deixou
-- de ter tela própria e passou a acontecer DENTRO das telas de método, onde o
-- diretor escolhe o setor e percorre as linhas. Cada linha ganha um "visto", e
-- é isto que esta tabela guarda.
--
-- Por que uma tabela e não uma coluna em cada tabela de item:
--   - o item do planejamento não é linha de tabela (vive no jsonb da proposta),
--     então não haveria onde pôr a coluna;
--   - a revisão é por RODADA: reenviou, tudo volta a ser não revisado. Uma
--     coluna teria de ser limpa a cada envio, e esquecer isso deixaria o
--     diretor com o setor "todo revisado" sem ter olhado a rodada nova.
--
-- A chave do alvo é textual e montada pelo código (`chaveDoAlvo`, em
-- src/lib/orcamento/validacao.ts): `colab:<uuid>`, `media:<uuid>`, `vf:<uuid>`
-- e `ps:<categoria>:<setor>:<descrição>`. O item do planejamento usa a
-- DESCRIÇÃO e não o índice de propósito: o índice muda quando alguém reordena a
-- proposta, e o visto pularia de item.
--
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.orcamento_revisoes (
  ciclo_id uuid NOT NULL REFERENCES public.orcamento_ciclos(id) ON DELETE CASCADE,
  rodada integer NOT NULL,
  alvo_chave text NOT NULL,
  alvo_tipo text NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  setor_id uuid REFERENCES public.orcamento_setores(id) ON DELETE SET NULL,
  metodo text,
  revisado_em timestamptz NOT NULL DEFAULT now(),
  revisado_por uuid REFERENCES public.users(id) ON DELETE SET NULL,
  PRIMARY KEY (ciclo_id, rodada, alvo_chave)
);

CREATE INDEX IF NOT EXISTS orcamento_revisoes_empresa_idx
  ON public.orcamento_revisoes (company_id, year, metodo, setor_id);

ALTER TABLE public.orcamento_revisoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orcamento_revisoes admin all" ON public.orcamento_revisoes;
CREATE POLICY "orcamento_revisoes admin all" ON public.orcamento_revisoes
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "orcamento_revisoes orcamento read" ON public.orcamento_revisoes;
CREATE POLICY "orcamento_revisoes orcamento read" ON public.orcamento_revisoes
  FOR SELECT TO authenticated USING (public.orcamento_pode_ler_empresa(company_id));

NOTIFY pgrst, 'reload schema';
