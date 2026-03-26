-- Access control hardening: users.active + role-aware policies

alter table public.users
  add column if not exists active boolean not null default true;

update public.users
set active = true
where active is null;

create index if not exists users_active_idx on public.users(active);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'admin'
      and u.active = true
  );
$$;

create or replace function public.is_hero_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'gestor_hero'
      and u.active = true
  );
$$;

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'companies'
      and policyname = 'Admin and hero read all companies'
  ) then
    alter policy "Admin and hero read all companies"
    on public.companies
    to authenticated
    using (public.is_admin() or public.is_hero_manager());
  else
    create policy "Admin and hero read all companies"
    on public.companies
    for select
    to authenticated
    using (public.is_admin() or public.is_hero_manager());
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'companies'
      and policyname = 'Gestor_unidade reads own company'
  ) then
    alter policy "Gestor_unidade reads own company"
    on public.companies
    to authenticated
    using (
      id in (
        select u.company_id
        from public.users u
        where u.id = auth.uid()
          and u.role = 'gestor_unidade'
          and u.active = true
      )
    );
  else
    create policy "Gestor_unidade reads own company"
    on public.companies
    for select
    to authenticated
    using (
      id in (
        select u.company_id
        from public.users u
        where u.id = auth.uid()
          and u.role = 'gestor_unidade'
          and u.active = true
      )
    );
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'financial_entries'
      and policyname = 'Read financial_entries by permission'
  ) then
    alter policy "Read financial_entries by permission"
    on public.financial_entries
    to authenticated
    using (
      public.is_admin()
      or public.is_hero_manager()
      or company_id in (
        select u.company_id
        from public.users u
        where u.id = auth.uid()
          and u.role = 'gestor_unidade'
          and u.active = true
      )
    );
  else
    create policy "Read financial_entries by permission"
    on public.financial_entries
    for select
    to authenticated
    using (
      public.is_admin()
      or public.is_hero_manager()
      or company_id in (
        select u.company_id
        from public.users u
        where u.id = auth.uid()
          and u.role = 'gestor_unidade'
          and u.active = true
      )
    );
  end if;
end $$;
