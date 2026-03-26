-- Fix doubled values in DRE dashboard:
-- Migration 20260325130000 accidentally reverted dashboard_dre_aggregate_by_company
-- back to the old double-LEFT-JOIN pattern, which produces duplicate rows when
-- category_mapping has multiple matches (e.g. both company-specific and global mappings).
-- This migration re-applies the LATERAL join fix to both aggregate functions
-- and ensures no duplicate category_mapping entries exist.

-- 1. Remove duplicate mappings (keep most recent per category_code + company_id scope).
delete from public.category_mapping
where id not in (
  select distinct on (omie_category_code, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid))
    id
  from public.category_mapping
  order by omie_category_code, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), created_at desc
);

-- 2. Ensure unique constraint exists (prevents future duplicates).
drop index if exists public.category_mapping_unique_scope_idx;
create unique index category_mapping_unique_scope_idx
  on public.category_mapping(
    omie_category_code,
    coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- 3. Fix dashboard_dre_aggregate with LATERAL join (single mapping per entry, no duplication).
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

-- 4. Fix dashboard_dre_aggregate_by_company with LATERAL join (regression introduced in 20260325130000).
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
