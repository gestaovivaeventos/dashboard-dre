-- ============================================================================
-- Módulo Departamento Pessoal (DP) — acesso.
--
-- Módulo SIGILOSO (salário, CPF, dados bancários, saúde ocupacional). Segue o
-- modelo do VB: acesso só por concessão em user_module_roles (module='dp',
-- role='gestor'), e admin NÃO passa por cima — ver src/lib/auth/dp.ts.
--
-- Esta migration faz três coisas:
--   1. Trava: linha module='dp' só é escrita pelo service role (ou migration).
--      A policy "Admin manages module roles" deixa QUALQUER admin escrever em
--      user_module_roles pelo PostgREST; sem a trava, um admin se concederia o
--      DP pelo console do navegador e o "admin não passa por cima" seria só de
--      fachada.
--   2. Predicado de policy dp_has_access(), para as tabelas dp_* que vierem.
--   3. Concessão inicial: Lucas Meireles e Marcelo Gonçalves.
-- ============================================================================

-- ── 1. Trava de escrita da concessão ────────────────────────────────────────
-- current_user é o papel do PostgREST (anon/authenticated/service_role) numa
-- requisição, e o dono da função/tabela em SECURITY DEFINER, cascata de FK e
-- migration. Barramos só os papéis de cliente: é exatamente o caminho que a
-- policy de admin abre.
CREATE OR REPLACE FUNCTION public.dp_guard_module_grant()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') AND (
       (TG_OP IN ('INSERT', 'UPDATE') AND NEW.module = 'dp')
    OR (TG_OP IN ('UPDATE', 'DELETE') AND OLD.module = 'dp')
  ) THEN
    RAISE EXCEPTION 'A concessão do módulo Departamento Pessoal só pode ser alterada pelo service role.'
      USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS dp_guard_module_grant ON public.user_module_roles;
CREATE TRIGGER dp_guard_module_grant
  BEFORE INSERT OR UPDATE OR DELETE ON public.user_module_roles
  FOR EACH ROW EXECUTE FUNCTION public.dp_guard_module_grant();

-- ── 2. Predicado de policy ──────────────────────────────────────────────────
-- Usado DENTRO de policies das tabelas dp_*, por isso fica executável por
-- authenticated (mesmo enquadramento de vb_role() e is_admin() na auditoria de
-- 03/09/2026). Não devolve dado nenhum além de true/false para o próprio
-- usuário. Usuário inativo não tem acesso, como no getSessionContext.
CREATE OR REPLACE FUNCTION public.dp_has_access()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_module_roles r
    JOIN public.users u ON u.id = r.user_id
    WHERE r.user_id = auth.uid()
      AND r.module = 'dp'
      AND r.role = 'gestor'
      AND u.active IS NOT FALSE
  );
$$;

REVOKE EXECUTE ON FUNCTION public.dp_has_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dp_has_access() TO authenticated, service_role;

-- A função do trigger não é chamada diretamente por ninguém.
REVOKE EXECUTE ON FUNCTION public.dp_guard_module_grant() FROM PUBLIC, anon, authenticated;

-- ── 3. Concessão inicial ────────────────────────────────────────────────────
-- Lookup por e-mail, sem UUID fixo (mesmo padrão do VB).
INSERT INTO public.user_module_roles (user_id, module, role)
SELECT id, 'dp', 'gestor'
FROM public.users
WHERE lower(email) IN ('lucas@quokka.net.br', 'marcelo@quokka.net.br')
ON CONFLICT DO NOTHING;

COMMENT ON FUNCTION public.dp_has_access() IS
  'Departamento Pessoal (sigiloso): o usuário da sessão tem a concessão (user_module_roles module=dp)? Admin não herda.';
