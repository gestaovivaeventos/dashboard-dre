-- Atualiza get_ctrl_role() para refletir o modelo unificado (users.profile + can_compras).
-- Antes a funcao so olhava user_module_roles; usuarios migrados pro novo modelo
-- ficavam com role NULL e o RLS de todas as tabelas ctrl_* bloqueava o acesso.
-- Fallback: se profile estiver nulo, mantem comportamento antigo (user_module_roles).
CREATE OR REPLACE FUNCTION public.get_ctrl_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH u AS (
    SELECT role, profile, can_compras, active
    FROM public.users
    WHERE id = auth.uid()
  )
  SELECT CASE
    WHEN (SELECT role = 'admin' AND active FROM u) THEN 'admin'
    WHEN (SELECT profile IS NOT NULL AND active FROM u) THEN (
      SELECT CASE
        WHEN profile = 'admin' THEN 'admin'
        WHEN profile = 'validador_contrato' THEN NULL
        WHEN profile = 'franqueado' THEN NULL
        WHEN NOT can_compras AND profile <> 'admin' THEN NULL
        WHEN profile = 'contas_a_pagar' THEN 'contas_a_pagar'
        WHEN profile = 'diretor' THEN 'diretor'
        WHEN profile = 'gerente' THEN 'gerente'
        WHEN profile = 'solicitante' THEN 'solicitante'
        ELSE NULL
      END
      FROM u
    )
    ELSE (
      SELECT role FROM public.user_module_roles
      WHERE user_id = auth.uid() AND module = 'ctrl' LIMIT 1
    )
  END;
$$;
