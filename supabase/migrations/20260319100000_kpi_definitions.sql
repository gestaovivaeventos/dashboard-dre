-- KPI definitions and company aggregation helper

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'kpi_formula_type'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.kpi_formula_type as enum ('percentage', 'value', 'ratio');
  end if;
end $$;

create table if not exists public.kpi_definitions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  formula_type public.kpi_formula_type not null default 'value',
  numerator_account_codes text[] not null default '{}',
  denominator_account_codes text[] default '{}',
  multiply_by numeric not null default 1,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists kpi_definitions_name_idx
  on public.kpi_definitions(name);

alter table public.kpi_definitions enable row level security;

create policy "Read KPI definitions authenticated"
on public.kpi_definitions
for select
to authenticated
using (true);

create policy "Write KPI definitions admin"
on public.kpi_definitions
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

insert into public.kpi_definitions (
  name,
  description,
  formula_type,
  numerator_account_codes,
  denominator_account_codes,
  multiply_by,
  sort_order,
  active
)
values
  (
    'Margem Bruta %',
    '(Receita Liquida - Custos com os Servicos Prestados) / Receita Liquida x 100',
    'percentage',
    array['4', '5'],
    array['4'],
    100,
    1,
    true
  ),
  (
    'Margem EBITDA %',
    'Resultado do Exercicio / Receita Liquida x 100',
    'percentage',
    array['11'],
    array['4'],
    100,
    2,
    true
  ),
  (
    'Margem Liquida %',
    'Resultado do Exercicio / Receita Liquida x 100',
    'percentage',
    array['11'],
    array['4'],
    100,
    3,
    true
  ),
  (
    'Receita Liquida',
    'Valor absoluto da Receita Liquida',
    'value',
    array['4'],
    array[]::text[],
    1,
    4,
    true
  ),
  (
    'Custo Fixo / Receita %',
    'Despesas Operacionais / Receita Liquida x 100',
    'percentage',
    array['7'],
    array['4'],
    100,
    5,
    true
  ),
  (
    'Resultado Financeiro',
    'Receitas Nao Operacionais - Despesas Nao Operacionais',
    'value',
    array['9', '10'],
    array[]::text[],
    1,
    6,
    true
  )
on conflict (name) do update
set
  description = excluded.description,
  formula_type = excluded.formula_type,
  numerator_account_codes = excluded.numerator_account_codes,
  denominator_account_codes = excluded.denominator_account_codes,
  multiply_by = excluded.multiply_by,
  sort_order = excluded.sort_order,
  active = excluded.active;

create or replace function public.dashboard_dre_aggregate_by_company(
  p_company_ids uuid[],
  p_date_from date,
  p_date_to date
)
returns table (
  company_id uuid,
  dre_account_id uuid,
  amount numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with mapped as (
    select
      fe.company_id,
      fe.value,
      coalesce(company_mapping.dre_account_id, global_mapping.dre_account_id) as dre_account_id
    from public.financial_entries fe
    left join public.category_mapping company_mapping
      on company_mapping.omie_category_code = fe.category_code
      and company_mapping.company_id = fe.company_id
    left join public.category_mapping global_mapping
      on global_mapping.omie_category_code = fe.category_code
      and global_mapping.company_id is null
    where fe.payment_date between p_date_from and p_date_to
      and fe.company_id = any(p_company_ids)
  )
  select
    mapped.company_id,
    mapped.dre_account_id,
    sum(mapped.value)::numeric as amount
  from mapped
  where mapped.dre_account_id is not null
  group by mapped.company_id, mapped.dre_account_id;
$$;

grant execute on function public.dashboard_dre_aggregate_by_company(uuid[], date, date) to authenticated;
