-- Contract Validation Module
-- Adds the contract validation feature: batches of contract checks against requisitions,
-- with AI-driven extraction (LandingAI ADE + LLM) and rule-based validation.
--
-- Scope: enabled per-company via companies.contract_validation_enabled.
-- Access: admin + gestor_hero (see PAGE_ACCESS_RULES in src/lib/auth/access.ts).

-- 1) Feature flag on companies ------------------------------------------------
alter table public.companies
  add column if not exists contract_validation_enabled boolean not null default false;

create index if not exists companies_contract_validation_enabled_idx
  on public.companies(contract_validation_enabled)
  where contract_validation_enabled = true;

-- 2) Status enums -------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'contract_batch_status') then
    create type public.contract_batch_status as enum (
      'pending',
      'processing',
      'completed',
      'failed'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'contract_item_status') then
    create type public.contract_item_status as enum (
      'pending',
      'processing',
      'aprovada',
      'reprovada',
      'analise_especialista',
      'erro'
    );
  end if;
end $$;

-- 3) contract_validation_batches ---------------------------------------------
create table if not exists public.contract_validation_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid not null references public.users(id) on delete restrict,
  name text not null,
  source_file_name text,
  status public.contract_batch_status not null default 'pending',
  total_items integer not null default 0,
  items_approved integer not null default 0,
  items_reproved integer not null default 0,
  items_failed integer not null default 0,
  items_specialist integer not null default 0,
  ai_credits_used numeric(12, 4) not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists contract_batches_company_idx
  on public.contract_validation_batches(company_id, created_at desc);

create index if not exists contract_batches_status_idx
  on public.contract_validation_batches(status)
  where status in ('pending', 'processing');

alter table public.contract_validation_batches enable row level security;

-- 4) contract_validation_items -----------------------------------------------
create table if not exists public.contract_validation_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.contract_validation_batches(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,

  -- requisition data (input, mirrors Aba A from the GCP script)
  requisicao_codigo text not null,
  fornecedor text,
  favorecido text,
  cpf_cnpj text,
  conta text,
  valor numeric(14, 2),
  link_contrato text not null,

  -- extracted contract data (mirrors Aba B)
  tipo_documento text,
  data_baile text,
  extracted_fornecedor text,
  extracted_cpf_cnpj text,
  extracted_banco text,
  extracted_agencia text,
  extracted_conta text,
  extracted_valor_contrato numeric(14, 2),
  extracted_pagamentos jsonb,
  assinatura_contratante text,
  assinatura_contratado text,
  assinatura_digital text,
  raw_extraction jsonb,

  -- validation result (mirrors Aba C)
  status public.contract_item_status not null default 'pending',
  status_motivos text[] not null default array[]::text[],
  status_resumo text,
  ai_credits numeric(10, 4) not null default 0,
  error_log text,
  processed_at timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists contract_items_batch_idx
  on public.contract_validation_items(batch_id);

create index if not exists contract_items_company_idx
  on public.contract_validation_items(company_id, created_at desc);

create index if not exists contract_items_status_idx
  on public.contract_validation_items(status)
  where status in ('pending', 'processing');

create index if not exists contract_items_pending_cron_idx
  on public.contract_validation_items(batch_id, created_at)
  where status = 'pending';

alter table public.contract_validation_items enable row level security;

-- 5) RLS policies -------------------------------------------------------------
-- Batches: admin + gestor_hero read/write on companies they have access to.
-- gestor_unidade is excluded by design (only franqueadora uses this).

create policy "Read contract batches"
  on public.contract_validation_batches
  for select
  to authenticated
  using (
    public.is_admin()
    or public.is_hero_manager()
  );

create policy "Insert contract batches"
  on public.contract_validation_batches
  for insert
  to authenticated
  with check (
    (public.is_admin() or public.is_hero_manager())
    and exists (
      select 1
      from public.companies c
      where c.id = company_id
        and c.contract_validation_enabled = true
    )
  );

create policy "Update contract batches"
  on public.contract_validation_batches
  for update
  to authenticated
  using (public.is_admin() or public.is_hero_manager())
  with check (public.is_admin() or public.is_hero_manager());

create policy "Delete contract batches"
  on public.contract_validation_batches
  for delete
  to authenticated
  using (public.is_admin());

-- Items: same access pattern as batches
create policy "Read contract items"
  on public.contract_validation_items
  for select
  to authenticated
  using (public.is_admin() or public.is_hero_manager());

create policy "Insert contract items"
  on public.contract_validation_items
  for insert
  to authenticated
  with check (public.is_admin() or public.is_hero_manager());

create policy "Update contract items"
  on public.contract_validation_items
  for update
  to authenticated
  using (public.is_admin() or public.is_hero_manager())
  with check (public.is_admin() or public.is_hero_manager());

create policy "Delete contract items"
  on public.contract_validation_items
  for delete
  to authenticated
  using (public.is_admin());

-- 6) updated_at trigger for batches ------------------------------------------
create or replace function public.contract_batches_touch_updated()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'completed' and old.status <> 'completed' then
    new.completed_at = coalesce(new.completed_at, now());
  end if;
  if new.status = 'processing' and old.status = 'pending' then
    new.started_at = coalesce(new.started_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists contract_batches_touch_updated_trg on public.contract_validation_batches;
create trigger contract_batches_touch_updated_trg
  before update on public.contract_validation_batches
  for each row execute function public.contract_batches_touch_updated();
