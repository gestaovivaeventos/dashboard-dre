-- Novo perfil 'gerente_setor' (exibido como "Gerente"). O perfil 'gerente'
-- existente passa a se chamar "Gerente Sócio" — só o RÓTULO muda, o valor
-- gravado em users.profile continua 'gerente' e nenhuma permissão foi alterada.
--
-- 'gerente_setor' tem exatamente as MESMAS permissões de 'gerente': por isso
-- get_ctrl_role() devolve 'gerente' para os dois, e todo o RLS de ctrl_*
-- (has_ctrl_role(ARRAY[...,'gerente',...])) continua valendo sem alteração.
-- A única diferença é na aplicação: em /ctrl/orcamento o 'gerente_setor' vê
-- apenas os setores vinculados a ele (user_sectors).

-- ── 1) Novo valor no enum public.user_profile ─────────────────────────────
ALTER TYPE public.user_profile ADD VALUE IF NOT EXISTS 'gerente_setor';

-- ── 2) get_ctrl_role(): 'gerente_setor' se comporta como 'gerente' ────────
-- IMPORTANTE: a CTE converte profile para TEXT (profile::text). Um valor de
-- enum recém-criado não pode ser usado como literal do próprio enum na mesma
-- transação (ERRO 55P04 "unsafe use of new value"), e comparar como texto
-- evita isso — permitindo rodar o passo 1 e o 2 juntos.
CREATE OR REPLACE FUNCTION public.get_ctrl_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH u AS (
    SELECT role, profile::text AS profile, can_compras, active
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
        -- 'gerente' (Gerente Sócio) e 'gerente_setor' (Gerente) compartilham
        -- as mesmas permissões no banco.
        WHEN profile IN ('gerente', 'gerente_setor') THEN 'gerente'
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
