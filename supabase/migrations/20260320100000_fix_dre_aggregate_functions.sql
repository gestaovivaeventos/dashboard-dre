-- Fix DRE aggregate functions: prevent value duplication from category_mapping joins
-- and ensure correct single-mapping lookup per financial entry.

-- 1. Add index on financial_entries.category_code for join performance.
create index if not exists financial_entries_category_code_idx
  on public.financial_entries(category_code);

-- 2. Fix unique constraint on category_mapping.
--    Old index allowed multiple mappings per (category_code, company_id) if dre_account_id differed.
--    New index enforces one mapping per (category_code, company_id).
drop index if exists public.category_mapping_unique_scope_idx;

create unique index category_mapping_unique_scope_idx
  on public.category_mapping(
    omie_category_code,
    coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- 3. Clean up any existing duplicate mappings before the constraint takes effect.
--    Keep only the most recent mapping per (category_code, company_id).
delete from public.category_mapping
where id not in (
  select distinct on (omie_category_code, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid))
    id
  from public.category_mapping
  order by omie_category_code, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), created_at desc
);

-- 4. Rewrite dashboard_dre_aggregate using LATERAL join for guaranteed single mapping per entry.
create or replace function public.dashboard_dre_aggregate(
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
    mapping.dre_account_id,
    sum(fe.value)::numeric as amount
  from public.financial_entries fe
  cross join lateral (
    select cm.dre_account_id
    from public.category_mapping cm
    where cm.omie_category_code = fe.category_code
      and (cm.company_id = fe.company_id or cm.company_id is null)
    order by cm.company_id nulls last
    limit 1
  ) mapping
  where fe.payment_date between p_date_from and p_date_to
    and fe.company_id = any(p_company_ids)
    and fe.category_code is not null
  group by mapping.dre_account_id;
$$;

grant execute on function public.dashboard_dre_aggregate(uuid[], date, date) to authenticated;

-- 5. Rewrite dashboard_dre_drilldown using LATERAL join.
create or replace function public.dashboard_dre_drilldown(
  p_dre_account_id uuid,
  p_company_ids uuid[],
  p_date_from date,
  p_date_to date,
  p_search text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  financial_entry_id uuid,
  payment_date date,
  description text,
  supplier_customer text,
  document_number text,
  value numeric,
  company_id uuid,
  company_name text,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select
      fe.id as financial_entry_id,
      fe.payment_date,
      fe.description,
      fe.supplier_customer,
      fe.document_number,
      fe.value,
      fe.company_id,
      c.name as company_name
    from public.financial_entries fe
    join public.companies c
      on c.id = fe.company_id
    cross join lateral (
      select cm.dre_account_id
      from public.category_mapping cm
      where cm.omie_category_code = fe.category_code
        and (cm.company_id = fe.company_id or cm.company_id is null)
      order by cm.company_id nulls last
      limit 1
    ) mapping
    where fe.payment_date between p_date_from and p_date_to
      and fe.company_id = any(p_company_ids)
      and fe.category_code is not null
      and mapping.dre_account_id = p_dre_account_id
      and (
        p_search is null
        or p_search = ''
        or fe.description ilike '%' || p_search || '%'
        or coalesce(fe.supplier_customer, '') ilike '%' || p_search || '%'
        or coalesce(fe.document_number, '') ilike '%' || p_search || '%'
      )
  ),
  counted as (
    select
      base.*,
      count(*) over() as total_count
    from base
    order by base.payment_date desc, base.financial_entry_id desc
    limit p_limit
    offset p_offset
  )
  select
    counted.financial_entry_id,
    counted.payment_date,
    counted.description,
    counted.supplier_customer,
    counted.document_number,
    counted.value,
    counted.company_id,
    counted.company_name,
    counted.total_count
  from counted;
$$;

grant execute on function public.dashboard_dre_drilldown(uuid, uuid[], date, date, text, integer, integer) to authenticated;

-- 6. Rewrite dashboard_dre_aggregate_by_company using LATERAL join.
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
  select
    fe.company_id,
    mapping.dre_account_id,
    sum(fe.value)::numeric as amount
  from public.financial_entries fe
  cross join lateral (
    select cm.dre_account_id
    from public.category_mapping cm
    where cm.omie_category_code = fe.category_code
      and (cm.company_id = fe.company_id or cm.company_id is null)
    order by cm.company_id nulls last
    limit 1
  ) mapping
  where fe.payment_date between p_date_from and p_date_to
    and fe.company_id = any(p_company_ids)
    and fe.category_code is not null
  group by fe.company_id, mapping.dre_account_id;
$$;

grant execute on function public.dashboard_dre_aggregate_by_company(uuid[], date, date) to authenticated;
