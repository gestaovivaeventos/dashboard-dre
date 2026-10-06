-- ============================================================================
-- Compras (CTRL) multiempresa — ETAPA A: a camada de "empresa" (organização de
-- compras) ACIMA do setor. Ver docs/superpowers/specs/2026-10-06-ctrl-multiempresa-design.md
--
-- Esta etapa é INERTE: cria as três tabelas, semeia a empresa "Viva Company" com
-- os CNPJs que já pagam hoje e concede essa empresa a todos os usuários que já
-- têm acesso ao Compras. NADA no app lê estas tabelas ainda (isso vem na etapa C),
-- então aplicar esta migration não muda comportamento nenhum. A coluna org_id nas
-- tabelas de domínio e o backfill vêm na ETAPA B (migration separada).
-- ============================================================================

-- A organização de compras. Na tela chama-se "empresa"; é um GRUPO de CNPJs
-- (a Viva Company são 5 CNPJs tratados como um só), não o `companies` (= CNPJ).
create table if not exists public.ctrl_orgs (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  slug       text not null unique,          -- usado no cookie/seletor do menu
  ativo      boolean not null default true,
  created_at timestamptz not null default now()
);

-- CNPJs pagadores de cada empresa (Viva: vários; Feat: 1). O UNIQUE(company_id)
-- garante que um CNPJ pague por UMA empresa só — senão o picker de pagador do
-- Contas a Pagar ficaria ambíguo e uma requisição da Feat poderia ser paga por
-- um CNPJ da Viva.
create table if not exists public.ctrl_org_companies (
  org_id     uuid not null references public.ctrl_orgs(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  primary key (org_id, company_id),
  unique (company_id)
);

-- Concessão de acesso por empresa (quais empresas do Compras o usuário alcança).
-- Admin não precisa de linha (ver a policy ctrl_has_org na etapa C); as linhas
-- aqui são para os demais perfis.
create table if not exists public.ctrl_user_orgs (
  user_id uuid not null references public.users(id) on delete cascade,
  org_id  uuid not null references public.ctrl_orgs(id) on delete cascade,
  primary key (user_id, org_id)
);
create index if not exists ctrl_user_orgs_org_idx on public.ctrl_user_orgs (org_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Leitura: o usuário só enxerga as empresas que lhe foram concedidas (admin vê
-- todas) — assim o seletor do menu nunca mostra uma empresa que ele não acessa.
-- Escrita: admin (o cadastro de empresa e a concessão são admin-only; o app
-- grava com o service role depois do gate, como no resto do módulo).
alter table public.ctrl_orgs enable row level security;
alter table public.ctrl_org_companies enable row level security;
alter table public.ctrl_user_orgs enable row level security;

create policy ctrl_orgs_read on public.ctrl_orgs
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.ctrl_user_orgs uo
      where uo.org_id = ctrl_orgs.id and uo.user_id = auth.uid()
    )
  );
create policy ctrl_orgs_write on public.ctrl_orgs
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy ctrl_org_companies_read on public.ctrl_org_companies
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.ctrl_user_orgs uo
      where uo.org_id = ctrl_org_companies.org_id and uo.user_id = auth.uid()
    )
  );
create policy ctrl_org_companies_write on public.ctrl_org_companies
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Cada um vê as PRÓPRIAS concessões (para a sessão resolver orgIds); admin vê e
-- gerencia todas (tela de Usuários).
create policy ctrl_user_orgs_read on public.ctrl_user_orgs
  for select to authenticated
  using (public.is_admin() or user_id = auth.uid());
create policy ctrl_user_orgs_write on public.ctrl_user_orgs
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ── Seed: a empresa "Viva Company" ──────────────────────────────────────────
insert into public.ctrl_orgs (nome, slug)
values ('Viva Company', 'viva-company')
on conflict (slug) do nothing;

-- Os CNPJs pagadores da Viva = as empresas que HOJE têm config Omie no Compras
-- (as únicas que podem pagar hoje). Auto-resolvido, sem id fixo.
--
-- CONFERIR ANTES DE APLICAR que o resultado bate com os 5 esperados (VE
-- Franqueadora, V Company, SPDX, Dataforte, VE Franqueadora Filial):
--   select c.id, c.name from companies c
--   where c.id in (select company_id from ctrl_company_omie_config) order by c.name;
insert into public.ctrl_org_companies (org_id, company_id)
select o.id, cc.company_id
from public.ctrl_orgs o
cross join (select distinct company_id from public.ctrl_company_omie_config) cc
where o.slug = 'viva-company'
on conflict do nothing;

-- Concede a empresa Viva a todos que HOJE têm acesso ao Compras. Over-grant é
-- inofensivo: entrar no módulo continua exigindo um papel CTRL — esta linha só
-- diz QUAL empresa, não SE a pessoa tem o módulo. Precisa cobrir todo mundo que
-- tem acesso hoje, senão (a partir da etapa C) a pessoa cairia numa lista vazia.
insert into public.ctrl_user_orgs (user_id, org_id)
select u.id, o.id
from public.users u
cross join public.ctrl_orgs o
where o.slug = 'viva-company'
  and u.active
  and (
    u.can_compras is true
    or u.profile in (
      'admin','solicitante','gerente','gerente_setor','diretor','contas_a_pagar','csc'
    )
    or exists (
      select 1 from public.user_module_roles r
      where r.user_id = u.id and r.module = 'ctrl'
    )
  )
on conflict do nothing;
