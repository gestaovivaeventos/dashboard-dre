-- =============================================================================
-- Módulo Orçamento — o GRUPO DE DESPESA passa a ter escopo por setor × categoria.
--
-- Nasceu (migration 20260925120000) como um catálogo simples por empresa: uma
-- lista de nomes, oferecida inteira em qualquer categoria. Na primeira rodada de
-- uso ficou claro que não serve — "Publicidade" não faz sentido em "Pró-labore",
-- e o gestor via uma lista longa de grupos que não tinham a ver com a despesa
-- que ele estava orçando.
--
-- ── Por que ESCOPO e não uma coluna no próprio grupo ───────────────────────
-- A alternativa óbvia seria pôr `setor_id` e `category_code` em
-- `orcamento_grupos_despesa`. Duas coisas quebram nesse desenho:
--
--   1. O índice único de nome é por empresa. "Publicidade" no Marketing do
--      Comercial e "Publicidade" no Marketing do Produto seriam DUAS linhas com
--      o mesmo nome — barradas pelo índice, e liberar o índice criaria nomes
--      repetidos que ninguém distingue na tela.
--   2. A Prévia agrupa por `grupo_id`. Dois ids com o mesmo nome viram DOIS
--      subníveis "Publicidade" lado a lado quando se olha vários setores
--      juntos — exatamente o oposto de "compilar, independente do setor", que é
--      o comportamento pedido.
--
-- Então o grupo continua sendo UM registro por empresa (o nome), e esta tabela
-- diz ONDE ele vale. O mesmo grupo aplicado a cinco pares (setor, categoria)
-- continua sendo um só na hora de somar.
--
-- ── Escopo vazio = grupo disponível em todo lugar ──────────────────────────
-- Grupo sem nenhuma linha aqui é oferecido em qualquer categoria/setor. É o
-- comportamento anterior, e é o que faz esta migration ser ADITIVA: o que já
-- estava cadastrado continua funcionando igual até alguém restringi-lo.
--
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.orcamento_grupo_escopo (
  grupo_id uuid NOT NULL REFERENCES public.orcamento_grupos_despesa(id) ON DELETE CASCADE,
  -- Denormalizados para a árvore do cadastro ler sem join. `year` vem do setor
  -- quando há setor; sem setor, é o ano em que o escopo foi definido.
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  -- Nulo = vale para a categoria em QUALQUER setor (empresa que não orça por
  -- setor, ou grupo que o admin quis deixar amplo).
  setor_id uuid REFERENCES public.orcamento_setores(id) ON DELETE CASCADE,
  category_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

-- Chave do escopo. COALESCE porque `setor_id` nulo é valor legítimo e um UNIQUE
-- comum deixaria passar duplicata com NULL (mesma armadilha da entrevista).
CREATE UNIQUE INDEX IF NOT EXISTS orcamento_grupo_escopo_chave_idx
  ON public.orcamento_grupo_escopo
     (grupo_id, company_id, year, category_code,
      COALESCE(setor_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Leitura da entrevista e da tela de montagem: "quais grupos valem aqui?".
CREATE INDEX IF NOT EXISTS orcamento_grupo_escopo_lookup_idx
  ON public.orcamento_grupo_escopo (company_id, year, category_code, setor_id);

-- ─── RLS — mesmo enquadramento do resto do módulo ────────────────────────────
ALTER TABLE public.orcamento_grupo_escopo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orcamento_grupo_escopo admin all" ON public.orcamento_grupo_escopo;
CREATE POLICY "orcamento_grupo_escopo admin all"
ON public.orcamento_grupo_escopo
FOR ALL TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "orcamento_grupo_escopo orcamento read" ON public.orcamento_grupo_escopo;
CREATE POLICY "orcamento_grupo_escopo orcamento read"
ON public.orcamento_grupo_escopo
FOR SELECT TO authenticated
USING (public.orcamento_pode_ler_empresa(company_id));

NOTIFY pgrst, 'reload schema';
