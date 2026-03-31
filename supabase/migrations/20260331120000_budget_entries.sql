-- =============================================================================
-- Budget entries table: stores planned/forecast values per DRE account,
-- company, and month. Used for "Previsto x Realizado" comparison.
-- =============================================================================

create table if not exists public.budget_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  dre_account_id uuid not null references public.dre_accounts(id) on delete cascade,
  year integer not null,
  month integer not null check (month between 1 and 12),
  amount numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (company_id, dre_account_id, year, month)
);

-- Index for fast lookups by company + period
create index if not exists budget_entries_company_period_idx
  on public.budget_entries(company_id, year, month);

-- RLS
alter table public.budget_entries enable row level security;

create policy "Authenticated users can read budget_entries"
  on public.budget_entries for select
  to authenticated
  using (true);

create policy "Authenticated users can insert budget_entries"
  on public.budget_entries for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update budget_entries"
  on public.budget_entries for update
  to authenticated
  using (true);

create policy "Authenticated users can delete budget_entries"
  on public.budget_entries for delete
  to authenticated
  using (true);

-- =============================================================================
-- RPC: Aggregate budget entries for given companies and date range.
-- Returns summed amounts per dre_account_id.
-- =============================================================================
create or replace function public.budget_aggregate(
  p_company_ids uuid[],
  p_date_from date,
  p_date_to date
)
returns table (
  dre_account_id uuid,
  amount numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    be.dre_account_id,
    sum(be.amount)::numeric as amount
  from public.budget_entries be
  where be.company_id = any(p_company_ids)
    and (be.year * 100 + be.month) >= (extract(year from p_date_from)::int * 100 + extract(month from p_date_from)::int)
    and (be.year * 100 + be.month) <= (extract(year from p_date_to)::int * 100 + extract(month from p_date_to)::int)
  group by be.dre_account_id;
$$;

grant execute on function public.budget_aggregate(uuid[], date, date) to authenticated;
