-- ============================================================
-- Control Hub — Roles por módulo (Abordagem B)
-- Permite que um usuário tenha roles independentes em cada módulo
-- ============================================================

-- Enum de roles da Controladoria
CREATE TYPE public.ctrl_role AS ENUM (
  'solicitante',
  'gerente',
  'diretor',
  'csc'
);

-- Tabela extensível: um role por módulo por usuário
-- UNIQUE(user_id, module) garante exatamente um role por módulo
CREATE TABLE public.user_module_roles (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  module     TEXT        NOT NULL,
  role       TEXT        NOT NULL,
  granted_by UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, module)
);

CREATE INDEX user_module_roles_user_id_idx ON public.user_module_roles(user_id);
CREATE INDEX user_module_roles_module_idx  ON public.user_module_roles(module);

ALTER TABLE public.user_module_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own module roles"
  ON public.user_module_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "Admin manages module roles"
  ON public.user_module_roles FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Retorna o role efetivo do usuário na Controladoria:
-- admin DRE → 'admin', caso contrário lê user_module_roles
CREATE OR REPLACE FUNCTION public.get_ctrl_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'admin' AND active = true
    ) THEN 'admin'
    ELSE (
      SELECT role FROM public.user_module_roles
      WHERE user_id = auth.uid() AND module = 'ctrl'
      LIMIT 1
    )
  END;
$$;

-- Verifica se o usuário tem um dos roles listados na Controladoria
CREATE OR REPLACE FUNCTION public.has_ctrl_role(required_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_ctrl_role() = ANY(required_roles);
$$;

GRANT EXECUTE ON FUNCTION public.get_ctrl_role()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_ctrl_role(TEXT[])    TO authenticated;
