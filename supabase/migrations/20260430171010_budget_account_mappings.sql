-- =============================================================================
-- Budget account mappings: links a row label from the uploaded budget XLSX to a
-- DRE account, per company. Allows the upload flow to convert raw spreadsheet
-- rows into budget_entries automatically once the label is mapped.
-- =============================================================================

create table if not exists public.budget_account_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  label text not null,
  dre_account_id uuid references public.dre_accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,

  unique (company_id, label)
);

create index if not exists budget_account_mappings_company_idx
  on public.budget_account_mappings(company_id);

alter table public.budget_account_mappings enable row level security;

create policy "Authenticated users can read budget_account_mappings"
  on public.budget_account_mappings for select
  to authenticated
  using (true);

create policy "Authenticated users can insert budget_account_mappings"
  on public.budget_account_mappings for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update budget_account_mappings"
  on public.budget_account_mappings for update
  to authenticated
  using (true);

create policy "Authenticated users can delete budget_account_mappings"
  on public.budget_account_mappings for delete
  to authenticated
  using (true);

-- =============================================================================
-- Raw budget uploads: stores the parsed XLSX rows verbatim so we can re-process
-- them whenever the user updates the label -> DRE account mapping. Each
-- (company, year, label, month) is unique; re-uploading the same year replaces
-- prior rows for that year.
-- =============================================================================

create table if not exists public.budget_uploads_raw (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  year integer not null,
  month integer not null check (month between 1 and 12),
  label text not null,
  amount numeric not null default 0,
  created_at timestamptz not null default now(),

  unique (company_id, year, month, label)
);

create index if not exists budget_uploads_raw_company_year_idx
  on public.budget_uploads_raw(company_id, year);

create index if not exists budget_uploads_raw_label_idx
  on public.budget_uploads_raw(company_id, label);

alter table public.budget_uploads_raw enable row level security;

create policy "Authenticated users can read budget_uploads_raw"
  on public.budget_uploads_raw for select
  to authenticated
  using (true);

create policy "Authenticated users can insert budget_uploads_raw"
  on public.budget_uploads_raw for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update budget_uploads_raw"
  on public.budget_uploads_raw for update
  to authenticated
  using (true);

create policy "Authenticated users can delete budget_uploads_raw"
  on public.budget_uploads_raw for delete
  to authenticated
  using (true);
