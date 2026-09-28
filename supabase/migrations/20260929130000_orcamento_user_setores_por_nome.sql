-- =============================================================================
-- Orçamento — a atribuição de setor passa a apontar para o SETOR DO ORÇAMENTO,
-- e não para o setor do Compras (29/09/2026, mesmo dia da tabela original).
--
-- ── O que estava errado ────────────────────────────────────────────────────
-- A primeira versão guardava `ctrl_sector_id` e casava com
-- `orcamento_setores.ctrl_sector_id`. Duas consequências, ambas observadas nos
-- dados reais desta base:
--
--   1. Setor do orçamento SEM ponte com o Compras era inatingível. Metade dos
--      setores cadastrados está assim ("Financeiro Cash Out", "Não atribuído"),
--      e a ponte é opcional de propósito — nem todo setor do orçamento existe
--      como setor de compras.
--   2. `cloneSetores` copia os setores de um ano para o outro SÓ PELO NOME e
--      não leva o `ctrl_sector_id` junto. Ou seja: a ponte se desfaz sozinha a
--      cada ano clonado, e com ela todo o escopo das pessoas.
--
-- ── Por que o NOME, e não o id da linha ────────────────────────────────────
-- `orcamento_setores` é por empresa × ANO, então o id vale para um ano só e a
-- atribuição precisaria ser refeita todo janeiro. O NOME dentro da empresa é a
-- identidade que o sistema JÁ usa para atravessar anos: `cloneSetores` casa por
-- `lower(trim(name))` para não duplicar. Guardando o nome, a atribuição
-- sobrevive ao clone sem nenhum trabalho extra e vale para qualquer ano.
--
-- O preço é o rename: `renameSetor` carrega a atribuição junto (está na action,
-- não em trigger, para o rastro ficar no código que o desenvolvedor lê).
--
-- ── Seguro recriar ─────────────────────────────────────────────────────────
-- A tabela anterior foi aplicada hoje e está VAZIA (nenhuma atribuição feita),
-- então não há dado a migrar: DROP + CREATE é mais honesto do que um ALTER que
-- deixaria a coluna velha como lixo.
-- =============================================================================

DROP TABLE IF EXISTS public.orcamento_user_setores;

CREATE TABLE public.orcamento_user_setores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Nome do setor NO ORÇAMENTO (orcamento_setores.name), não no Compras.
  -- Guardado como digitado; a comparação é case-insensitive (ver o índice).
  setor_nome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT orcamento_user_setores_nome_chk CHECK (btrim(setor_nome) <> '')
);

-- A atribuição é um FATO: marcar duas vezes é marcar uma. `lower(btrim(...))`
-- para "Marketing" e "marketing " não virarem duas linhas — a mesma
-- normalização que `cloneSetores` usa ao casar nomes entre anos.
CREATE UNIQUE INDEX orcamento_user_setores_unico_idx
  ON public.orcamento_user_setores (user_id, company_id, lower(btrim(setor_nome)));

-- Leitura quente: "quais setores DESTA empresa são deste usuário" — roda em
-- toda action de escrita do módulo (autorizarEscrita).
CREATE INDEX orcamento_user_setores_escopo_idx
  ON public.orcamento_user_setores (user_id, company_id);

-- Leitura da tela de Usuários: o cadastro inteiro de uma pessoa.
CREATE INDEX orcamento_user_setores_user_idx
  ON public.orcamento_user_setores (user_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Escrita só de admin (a tela de Usuários é admin-only e grava com service
-- role). Leitura: admin vê tudo e cada pessoa vê as próprias linhas — é o que
-- permite o módulo resolver o escopo sem depender do admin client, e não vaza
-- nada: são os setores dela mesma.
ALTER TABLE public.orcamento_user_setores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orcamento_user_setores admin all"
ON public.orcamento_user_setores
FOR ALL TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "orcamento_user_setores self read"
ON public.orcamento_user_setores
FOR SELECT TO authenticated
USING (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
