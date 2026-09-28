-- =============================================================================
-- Módulo Orçamento — VALIDAÇÃO da diretoria, versão simples (25/09/2026).
--
-- O aparato anterior (validacao.ts, revisao.ts, retorno.ts, barra-validacao,
-- ciclo, trava por fase) foi removido em 24/09/2026 por ser complexo demais
-- para o que se queria. Esta é a reconstrução, e a regra é UMA linha por item
-- decidido — nada de fases, rodadas, versões ou entregas por setor.
--
-- ── O que o diretor faz ────────────────────────────────────────────────────
-- Em cada item da prévia do setor ele marca:
--   'aprovado'  → entra no número da empresa; o gestor NÃO edita mais
--   'reprovado' → sai do número; o gestor NÃO edita
--   'revisar'   → sai do número; o gestor EDITA (é o único estado em que ele
--                 mexe), com o comentário do diretor dizendo o que mudar
-- Item sem linha aqui é PENDENTE: fora do número e editável.
--
-- ── A trava deriva do status, e isso é de propósito ────────────────────────
-- O modelo antigo tinha uma coluna `diretoria_travado` escrita e liberada à
-- mão, e foi ela que deixou colaboradores presos sem saída pela tela. Aqui não
-- há coluna de trava: quem decide se o gestor edita é o próprio `status`.
--
-- ── Invalidação por edição, sem hook em lugar nenhum ───────────────────────
-- A decisão guarda `decidido_em`. Se o item foi alterado depois disso
-- (`updated_at` maior), a decisão está VENCIDA e o item volta a contar como
-- pendente. Nenhuma das 15 actions de escrita precisa saber que a validação
-- existe, e caminho de escrita novo já nasce coberto.
--
-- ── Por que `alvo_id` é TEXT ───────────────────────────────────────────────
-- Três alvos são uuid de linha (colaborador, contrato de valor fixo, despesa
-- do planejamento), mas a MÉDIA é chaveada por (categoria, setor) — a linha
-- pode nem existir enquanto o gestor não salva. Um text acomoda os dois sem
-- uma segunda tabela.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.orcamento_validacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  -- Denormalizados para o contador do card e o recorte do gestor sem join.
  metodo text NOT NULL,
  setor_id uuid REFERENCES public.orcamento_setores(id) ON DELETE CASCADE,
  alvo_tipo text NOT NULL,
  alvo_id text NOT NULL,
  -- Rótulo do item no momento da decisão: sobrevive à renomeação e à exclusão.
  alvo_rotulo text,
  status text NOT NULL,
  -- O "balãozinho": o que o diretor quer que o gestor mude. Comentário ÚNICO,
  -- não conversa (decisão do dono do projeto): o gestor responde EDITANDO, e a
  -- edição devolve o item para a fila do diretor.
  comentario text,
  decidido_em timestamptz NOT NULL DEFAULT now(),
  decidido_por uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Uma decisão por item: decidir de novo SOBRESCREVE. O histórico de quem
-- mudou o quê é da trilha (`orcamento_alteracoes`), que já registra tudo.
CREATE UNIQUE INDEX IF NOT EXISTS orcamento_validacoes_alvo_idx
  ON public.orcamento_validacoes (company_id, year, alvo_tipo, alvo_id);

-- Leitura da prévia (filtrar o aprovado) e dos contadores por método.
CREATE INDEX IF NOT EXISTS orcamento_validacoes_escopo_idx
  ON public.orcamento_validacoes (company_id, year, metodo, setor_id, status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orcamento_validacoes_status_chk'
      AND conrelid = 'public.orcamento_validacoes'::regclass
  ) THEN
    ALTER TABLE public.orcamento_validacoes
      ADD CONSTRAINT orcamento_validacoes_status_chk
      CHECK (status IN ('aprovado', 'reprovado', 'revisar'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orcamento_validacoes_alvo_tipo_chk'
      AND conrelid = 'public.orcamento_validacoes'::regclass
  ) THEN
    ALTER TABLE public.orcamento_validacoes
      ADD CONSTRAINT orcamento_validacoes_alvo_tipo_chk
      CHECK (alvo_tipo IN (
        'colaborador',
        'media_linha',
        'valor_fixo_contrato',
        'planejamento_item'
      ));
  END IF;
END $$;

DROP TRIGGER IF EXISTS orcamento_validacoes_touch_updated_at_trg
  ON public.orcamento_validacoes;
CREATE TRIGGER orcamento_validacoes_touch_updated_at_trg
BEFORE UPDATE ON public.orcamento_validacoes
FOR EACH ROW EXECUTE FUNCTION public.orcamento_touch_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Mesmo enquadramento do resto do módulo: LEITURA para quem tem o módulo e
-- alcança a empresa (o gestor precisa VER a decisão que o afeta); ESCRITA só
-- `is_admin()` na policy, porque o caminho real é o service role nas actions,
-- onde o papel de diretor é conferido.
ALTER TABLE public.orcamento_validacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orcamento_validacoes admin all" ON public.orcamento_validacoes;
CREATE POLICY "orcamento_validacoes admin all"
ON public.orcamento_validacoes
FOR ALL TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "orcamento_validacoes orcamento read" ON public.orcamento_validacoes;
CREATE POLICY "orcamento_validacoes orcamento read"
ON public.orcamento_validacoes
FOR SELECT TO authenticated
USING (public.orcamento_pode_ler_empresa(company_id));

NOTIFY pgrst, 'reload schema';
