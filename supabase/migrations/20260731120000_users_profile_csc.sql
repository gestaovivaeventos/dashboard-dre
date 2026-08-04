-- Novo perfil 'csc' (exibido como "CSC").
--
-- REGRA: nasce como CÓPIA FUNCIONAL do perfil 'franqueado' ("Visão Financeira").
-- Mesmas telas, mesmas permissões, mesmo escopo por empresa (user_company_access).
-- O perfil 'franqueado' NÃO é alterado: continua existindo, com as mesmas
-- permissões e com os mesmos usuários. Nenhum usuário é migrado por esta
-- migration — o admin passa a poder ESCOLHER "CSC" na tela de Usuários.
--
-- A única diferença (na aplicação, não no banco) é a tela nova
-- /financeiro/validacao-relatorio, liberada para CSC + admin + os e-mails
-- marcela@quokka.net.br e marcelo@quokka.net.br.

-- ── 1) Novo valor no enum public.user_profile ─────────────────────────────
ALTER TYPE public.user_profile ADD VALUE IF NOT EXISTS 'csc';

-- ── 2) get_ctrl_role(): 'csc' NÃO dá acesso ao módulo Compras ─────────────
-- Igual ao 'franqueado' — o perfil é uma visão restrita do Financeiro. Sem
-- esta linha, um usuário CSC cairia no ELSE (NULL) por acidente; deixamos
-- explícito para não depender do fallback.
--
-- IMPORTANTE: a CTE converte profile para TEXT (profile::text). Um valor de
-- enum recém-criado não pode ser usado como literal do próprio enum na mesma
-- transação (ERRO 55P04 "unsafe use of new value") — comparar como texto
-- permite rodar os passos 1 e 2 juntos.
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
        -- Visão Financeira restrita (cópia do franqueado): sem módulo Compras.
        WHEN profile = 'csc' THEN NULL
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
