-- ============================================================================
-- Compras (CTRL) — PAPEL POR EMPRESA (override opcional).
-- Ver docs/superpowers/specs/2026-10-07-ctrl-papel-por-empresa-usuarios.md.
--
-- Hoje o papel do Compras é GLOBAL (users.profile → deriveCtrlRoles). Esta
-- coluna permite ESTREITAR o papel de um usuário dentro de UMA empresa do
-- Compras (ex.: "Contas a Pagar na Viva, Solicitante na Feat").
--
-- ADITIVO E DIFF-ZERO: anulável, SEM default, SEM backfill. As 37 linhas
-- existentes ficam com role = NULL → cada usuário segue com o papel do perfil
-- global em todas as empresas → comportamento IDÊNTICO ao de hoje. A resolução
-- em src/lib/ctrl/roles.ts (resolveCtrlRolesForOrg) só toma o ramo do override
-- quando role IS NOT NULL. O recurso nasce desligado para todos.
--
-- RLS NÃO MUDA: ctrl_has_org(org_id) checa pertencimento, não lê `role`. O
-- papel por empresa é refinamento de APLICAÇÃO (como requireCtrlRole já é hoje).
-- ============================================================================

alter table public.ctrl_user_orgs
  add column if not exists role text;

-- Vocabulário fechado (o MESMO de CTRL_ORG_ROLE_VALUES em src/lib/ctrl/roles.ts).
-- Pega erro de digitação numa coluna `text` que entra numa decisão de permissão.
-- 'admin' NÃO entra de propósito: admin é papel GLOBAL, nunca por empresa.
-- franqueado/csc/validador_contrato não são papéis do Compras.
alter table public.ctrl_user_orgs
  drop constraint if exists ctrl_user_orgs_role_chk;
alter table public.ctrl_user_orgs
  add constraint ctrl_user_orgs_role_chk
  check (
    role is null
    or role in ('solicitante', 'gerente', 'gerente_setor', 'diretor', 'contas_a_pagar')
  );

comment on column public.ctrl_user_orgs.role is
  'Papel do Compras do usuário NESTA empresa (override). NULL = usa o perfil global (users.profile). Nunca ''admin'' (admin é global). Ver src/lib/ctrl/roles.ts.';
