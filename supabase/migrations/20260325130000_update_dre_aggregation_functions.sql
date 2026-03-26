-- Atualizar funções de agregação da DRE para usar período derivado
-- Essas funções são críticas para a consolidação correta dos dados

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
  with filtered_entries as (
    select
      fe.id as financial_entry_id,
      fe.company_id,
      fe.value,
      fe.payment_date,
      fe.ano_pgto,
      fe.mes_pagamento,
      fe.category_code,
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
    filtered_entries.company_id,
    filtered_entries.dre_account_id,
    sum(filtered_entries.value)::numeric as amount
  from filtered_entries
  where filtered_entries.dre_account_id is not null
  group by filtered_entries.company_id, filtered_entries.dre_account_id;
$$;

grant execute on function public.dashboard_dre_aggregate_by_company(uuid[], date, date) to authenticated;

-- ===========================================================================
-- Função auxiliar para auditoria e debug
-- Retorna todos os lançamentos processados com seus metadados
-- ===========================================================================
create or replace function public.debug_financial_entries_detailed(
  p_company_ids uuid[],
  p_date_from date,
  p_date_to date,
  p_limit integer default 100
)
returns table (
  omie_id text,
  company_id uuid,
  payment_date date,
  ano_pgto integer,
  mes_pagamento integer,
  category_code text,
  type text,
  value numeric,
  description text,
  verificador_rateio integer,
  corretor_duplicidade integer,
  source_field_value text,
  processing_metadata jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    fe.omie_id,
    fe.company_id,
    fe.payment_date,
    fe.ano_pgto,
    fe.mes_pagamento,
    fe.category_code,
    fe.type,
    fe.value,
    fe.description,
    (fe.processing_metadata->>'verificador_rateio')::integer as verificador_rateio,
    (fe.processing_metadata->>'corretor_duplicidade')::integer as corretor_duplicidade,
    fe.processing_metadata->>'source_field_value' as source_field_value,
    fe.processing_metadata
  from public.financial_entries fe
  where fe.company_id = any(p_company_ids)
    and fe.payment_date between p_date_from and p_date_to
  order by fe.payment_date desc, fe.company_id, fe.omie_id
  limit p_limit;
$$;

grant execute on function public.debug_financial_entries_detailed(uuid[], date, date, integer) to authenticated;

-- ===========================================================================
-- Função para auditoria de rateios
-- Mostra lançamentos que foram rateados e seus sub-itens
-- ===========================================================================
create or replace function public.audit_rateio_entries(
  p_company_ids uuid[],
  p_date_from date,
  p_date_to date
)
returns table (
  base_omie_id text,
  omie_id_rateado text,
  payment_date date,
  ano_pgto integer,
  mes_pagamento integer,
  category_code text,
  value numeric,
  verificador_rateio integer,
  corretor_duplicidade integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    replace(fe.omie_id, concat(':r', substr(fe.omie_id, position(':r' in fe.omie_id))), '') as base_omie_id,
    fe.omie_id as omie_id_rateado,
    fe.payment_date,
    fe.ano_pgto,
    fe.mes_pagamento,
    fe.category_code,
    fe.value,
    (fe.processing_metadata->>'verificador_rateio')::integer as verificador_rateio,
    (fe.processing_metadata->>'corretor_duplicidade')::integer as corretor_duplicidade
  from public.financial_entries fe
  where fe.company_id = any(p_company_ids)
    and fe.payment_date between p_date_from and p_date_to
    and (fe.processing_metadata->>'corretor_duplicidade')::integer = 0
  order by base_omie_id, fe.omie_id;
$$;

grant execute on function public.audit_rateio_entries(uuid[], date, date) to authenticated;
