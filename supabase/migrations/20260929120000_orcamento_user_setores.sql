-- =============================================================================
-- Módulo Orçamento — SETOR POR EMPRESA (29/09/2026).
--
-- Até aqui o setor de uma pessoa era GLOBAL: `user_sectors` aponta para
-- `ctrl_sectors`, que não tem empresa. Quem era "Marketing" pegava o Marketing
-- de TODA empresa que alcançava, e não havia como dizer "ela responde por
-- Marketing na Sirena, mas não na Feat" — que é o recorte real do orçamento.
--
-- ── Por que uma tabela nova, e não uma coluna em user_sectors ───────────────
-- `user_sectors` é do COMPRAS (163 linhas em uso: alçada de aprovação, filtro
-- da tela de Aprovações, destinatário do lembrete diário). Acrescentar empresa
-- ali mudaria o significado das linhas existentes e mexeria num fluxo que
-- funciona. São dois recortes diferentes de propósito: o Compras aprova por
-- setor, o Orçamento constrói por setor DENTRO de uma empresa.
--
-- ── Por que aponta para ctrl_sectors, e não para orcamento_setores ─────────
-- `orcamento_setores` é por empresa × ANO. Amarrar a atribuição a ele obrigaria
-- a refazer o cadastro de todo mundo a cada janeiro. Apontando para
-- `ctrl_sectors` (o vocabulário estável de setores), a ponte já existente
-- `orcamento_setores.ctrl_sector_id` resolve o ano sozinha.
--
-- ── Seguro aplicar ─────────────────────────────────────────────────────────
-- Nenhum usuário tinha a concessão do módulo quando isto foi escrito (zero
-- linhas em user_module_roles com module='orcamento'), então não há escopo
-- existente para preservar: o Orçamento passa a ler SÓ esta tabela, e o
-- `user_sectors` volta a ser exclusivo do Compras.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.orcamento_user_setores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- O setor no vocabulário do Compras. A ponte por ano é
  -- `orcamento_setores.ctrl_sector_id`.
  ctrl_sector_id uuid NOT NULL REFERENCES public.ctrl_sectors(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

-- A atribuição é um FATO, não um valor: marcar duas vezes é a mesma coisa que
-- marcar uma. O índice é o que permite o upsert idempotente da tela.
CREATE UNIQUE INDEX IF NOT EXISTS orcamento_user_setores_unico_idx
  ON public.orcamento_user_setores (user_id, company_id, ctrl_sector_id);

-- Leitura quente: "quais setores DESTA empresa são deste usuário" — roda em
-- toda action de escrita do módulo (autorizarEscrita).
CREATE INDEX IF NOT EXISTS orcamento_user_setores_escopo_idx
  ON public.orcamento_user_setores (user_id, company_id);

-- Leitura da tela de Usuários: o cadastro inteiro de uma pessoa.
CREATE INDEX IF NOT EXISTS orcamento_user_setores_user_idx
  ON public.orcamento_user_setores (user_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Escrita só de admin (a tela de Usuários é admin-only e grava com service
-- role). Leitura: o admin vê tudo e QUALQUER pessoa vê as próprias linhas —
-- é o que permite o módulo resolver o escopo sem depender do admin client, e
-- não vaza nada: são os setores dela mesma.
ALTER TABLE public.orcamento_user_setores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orcamento_user_setores admin all" ON public.orcamento_user_setores;
CREATE POLICY "orcamento_user_setores admin all"
ON public.orcamento_user_setores
FOR ALL TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "orcamento_user_setores self read" ON public.orcamento_user_setores;
CREATE POLICY "orcamento_user_setores self read"
ON public.orcamento_user_setores
FOR SELECT TO authenticated
USING (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
