-- Dashboard DRE optimized functions (aggregation + drilldown)

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
  with mapped as (
    select
      fe.id as financial_entry_id,
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
    mapped.dre_account_id,
    sum(mapped.value)::numeric as amount
  from mapped
  where mapped.dre_account_id is not null
  group by mapped.dre_account_id;
$$;

grant execute on function public.dashboard_dre_aggregate(uuid[], date, date) to authenticated;

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
    left join public.category_mapping company_mapping
      on company_mapping.omie_category_code = fe.category_code
      and company_mapping.company_id = fe.company_id
    left join public.category_mapping global_mapping
      on global_mapping.omie_category_code = fe.category_code
      and global_mapping.company_id is null
    where fe.payment_date between p_date_from and p_date_to
      and fe.company_id = any(p_company_ids)
      and coalesce(company_mapping.dre_account_id, global_mapping.dre_account_id) = p_dre_account_id
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
