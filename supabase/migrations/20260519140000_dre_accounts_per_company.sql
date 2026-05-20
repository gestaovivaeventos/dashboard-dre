-- Per-company DRE accounts (Phase 1)
-- Allows each company to have its own custom DRE plan. Companies without a
-- custom plan continue to use the global plan (company_id IS NULL), which
-- preserves the current behavior for all existing companies (notably the
-- Franquias Viva segment).

alter table public.dre_accounts
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

-- Replace the global UNIQUE constraint on `code` with two partial unique
-- indexes so the same code can exist once globally AND once per company.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'dre_accounts_code_key' and conrelid = 'public.dre_accounts'::regclass
  ) then
    alter table public.dre_accounts drop constraint dre_accounts_code_key;
  end if;
end $$;

create unique index if not exists dre_accounts_global_code_idx
  on public.dre_accounts(code)
  where company_id is null;

create unique index if not exists dre_accounts_company_code_idx
  on public.dre_accounts(company_id, code)
  where company_id is not null;

create index if not exists dre_accounts_company_idx
  on public.dre_accounts(company_id);

-- Enforce that a child account lives in the same scope as its parent
-- (both global, or both belonging to the same company). This prevents
-- a custom company account from being attached to the global tree, which
-- would break per-company isolation.
create or replace function public.dre_accounts_check_parent_scope()
returns trigger
language plpgsql
as $$
declare
  parent_company_id uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  select company_id into parent_company_id
  from public.dre_accounts
  where id = new.parent_id;

  if parent_company_id is distinct from new.company_id then
    raise exception 'parent account scope mismatch: parent.company_id=% but new.company_id=%',
      parent_company_id, new.company_id;
  end if;

  return new;
end;
$$;

drop trigger if exists dre_accounts_parent_scope_trigger on public.dre_accounts;
create trigger dre_accounts_parent_scope_trigger
  before insert or update on public.dre_accounts
  for each row execute function public.dre_accounts_check_parent_scope();

-- Auto-compute `level` from `code` on insert/update. The seed migration
-- computes level inline; this trigger ensures level stays consistent when
-- new accounts are added via the API (where the caller might omit it).
create or replace function public.dre_accounts_set_level()
returns trigger
language plpgsql
as $$
begin
  new.level := array_length(string_to_array(new.code, '.'), 1);
  return new;
end;
$$;

drop trigger if exists dre_accounts_level_trigger on public.dre_accounts;
create trigger dre_accounts_level_trigger
  before insert or update of code on public.dre_accounts
  for each row execute function public.dre_accounts_set_level();

-- Update RLS write policy to scope edits to the appropriate plan:
-- admins can edit any account (global or per-company). Non-admins cannot
-- write to dre_accounts at all (unchanged from prior policy).
-- (Keep the existing policy; admin check is sufficient.)
