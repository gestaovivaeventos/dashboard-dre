-- Hero DRE Dashboard - Sync Engine schema

create table if not exists public.sync_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('success', 'error', 'running')),
  records_imported integer not null default 0,
  error_message text
);

create index if not exists sync_log_company_started_idx
  on public.sync_log(company_id, started_at desc);

create table if not exists public.financial_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  omie_id text not null,
  type text not null check (type in ('receita', 'despesa')),
  description text not null,
  value numeric(16, 2) not null default 0,
  payment_date date not null,
  category_code text,
  category_name text,
  supplier_customer text,
  document_number text,
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(company_id, omie_id)
);

create index if not exists financial_entries_company_payment_idx
  on public.financial_entries(company_id, payment_date desc);

create index if not exists financial_entries_company_type_idx
  on public.financial_entries(company_id, type);

create table if not exists public.omie_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  description text not null,
  created_at timestamptz not null default now(),
  unique(company_id, code)
);

alter table public.sync_log enable row level security;
alter table public.financial_entries enable row level security;
alter table public.omie_categories enable row level security;

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
  );
$$;

grant execute on function public.is_hero_manager() to authenticated;

-- Expand companies permissions so admin can create/update/delete credentials.
create policy "Admins manage companies"
on public.companies
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Sync log policies
create policy "Read sync_log by permission"
on public.sync_log
for select
to authenticated
using (
  public.is_admin()
  or public.is_hero_manager()
  or company_id in (
    select u.company_id
    from public.users u
    where u.id = auth.uid()
  )
);

create policy "Write sync_log by permission"
on public.sync_log
for all
to authenticated
using (
  public.is_admin()
  or public.is_hero_manager()
  or company_id in (
    select u.company_id
    from public.users u
    where u.id = auth.uid()
  )
)
with check (
  public.is_admin()
  or public.is_hero_manager()
  or company_id in (
    select u.company_id
    from public.users u
    where u.id = auth.uid()
  )
);

-- Financial entries policies
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
  )
);

create policy "Write financial_entries by permission"
on public.financial_entries
for all
to authenticated
using (
  public.is_admin()
  or public.is_hero_manager()
  or company_id in (
    select u.company_id
    from public.users u
    where u.id = auth.uid()
  )
)
with check (
  public.is_admin()
  or public.is_hero_manager()
  or company_id in (
    select u.company_id
    from public.users u
    where u.id = auth.uid()
  )
);

-- Omie categories policies
create policy "Read omie_categories by permission"
on public.omie_categories
for select
to authenticated
using (
  public.is_admin()
  or public.is_hero_manager()
  or company_id in (
    select u.company_id
    from public.users u
    where u.id = auth.uid()
  )
);

create policy "Write omie_categories by permission"
on public.omie_categories
for all
to authenticated
using (
  public.is_admin()
  or public.is_hero_manager()
  or company_id in (
    select u.company_id
    from public.users u
    where u.id = auth.uid()
  )
)
with check (
  public.is_admin()
  or public.is_hero_manager()
  or company_id in (
    select u.company_id
    from public.users u
    where u.id = auth.uid()
  )
);
