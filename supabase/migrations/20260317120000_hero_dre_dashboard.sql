-- Hero DRE Dashboard - Initial schema
-- Execute no SQL Editor do Supabase ou via CLI (`supabase db push`)

create extension if not exists pgcrypto;

create type public.user_role as enum ('admin', 'gestor_hero', 'gestor_unidade');

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  omie_app_key text,
  omie_app_secret text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text,
  role public.user_role not null default 'gestor_unidade',
  company_id uuid references public.companies(id) on delete set null,
  created_at timestamptz not null default now()
);

create index users_company_id_idx on public.users(company_id);
create index users_role_idx on public.users(role);

alter table public.users enable row level security;
alter table public.companies enable row level security;

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
  );
$$;

grant execute on function public.is_admin() to authenticated;

create policy "Users can read own data"
on public.users
for select
to authenticated
using (id = auth.uid());

create policy "Admins can read all users"
on public.users
for select
to authenticated
using (public.is_admin());

create policy "Admins can read all companies"
on public.companies
for select
to authenticated
using (public.is_admin());

create policy "Users can read own company"
on public.companies
for select
to authenticated
using (
  id in (
    select u.company_id
    from public.users u
    where u.id = auth.uid()
  )
);
