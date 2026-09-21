-- Preferências por usuário, genéricas: uma linha por (usuário, chave), valor
-- em JSON. Primeiro uso: os filtros da tela Caixa Real (chave 'caixa_real'),
-- que precisam sobreviver a logout, a dias sem entrar e a troca de máquina —
-- localStorage não serve (é por navegador, não por pessoa).
--
-- Genérica de propósito: a próxima tela que precisar lembrar algo de alguém
-- usa uma chave nova aqui, em vez de mais um truque em user_module_roles
-- (como o tour_seen) ou mais uma coluna em users.
--
-- Cada usuário lê e escreve SÓ a própria linha (policy por auth.uid()). O
-- service role também passa — as rotas do Caixa escrevem por ele depois do
-- gate do módulo, com o user_id vindo da sessão, nunca do corpo.

CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_preferences_own ON public.user_preferences;
CREATE POLICY user_preferences_own ON public.user_preferences
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
