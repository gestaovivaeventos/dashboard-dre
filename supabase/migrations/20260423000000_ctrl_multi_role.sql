-- ============================================================
-- Control Hub — Multi-permissao por modulo
-- Remove UNIQUE(user_id, module) para permitir que um usuario tenha
-- varias permissoes (roles) simultaneas no mesmo modulo.
-- Exemplo: um gerente com permissao adicional "aprovacao_fornecedor".
-- ============================================================

-- 1. Remover a constraint de unicidade (o nome e gerado automaticamente)
--    Usamos DO block para tornar idempotente.
DO $$
DECLARE
  constraint_name_var TEXT;
BEGIN
  SELECT conname INTO constraint_name_var
  FROM pg_constraint
  WHERE conrelid = 'public.user_module_roles'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) LIKE '%(user_id, module)%';

  IF constraint_name_var IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.user_module_roles DROP CONSTRAINT %I', constraint_name_var);
  END IF;
END $$;

-- 2. Garantir unicidade da tupla completa (user_id, module, role) para evitar
--    duplicatas exatas (ex.: inserir 'csc' duas vezes para o mesmo user/module).
CREATE UNIQUE INDEX IF NOT EXISTS user_module_roles_user_module_role_uniq
  ON public.user_module_roles(user_id, module, role);

-- NOTA: a funcao get_ctrl_role() criada na migration original ainda retorna
-- apenas UM role (o primeiro encontrado). Ela esta DEPRECADA - o app agora
-- le todas as linhas diretamente via session.ts. Nao removemos a funcao
-- para nao quebrar qualquer RLS/policy eventual que dependa dela.
