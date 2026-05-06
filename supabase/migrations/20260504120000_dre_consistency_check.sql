-- =============================================================================
-- DRE consistency check & freshness helpers.
--
-- Contexto do bug recorrente:
-- O Dashboard DRE (Server Component) renderiza um snapshot do banco no
-- instante T1 e exibe os valores agregados por conta. O Drilldown (chamada
-- client-side) consulta o banco no instante T3 quando o usuario clica.
-- Se entre T1 e T3 o sync rodou e modificou financial_entries, o Drilldown
-- mostra um total diferente da celula do Dashboard, e o usuario percebe
-- isso como bug de calculo. A causa raiz e timing, nao SQL.
--
-- Esta migration adiciona dois RPCs defensivos:
--
-- 1) dashboard_dre_consistency_check: devolve, para uma janela e conjunto
--    de empresas, o valor canonico agregado por (company_id, dre_account_id)
--    no INSTANTE da chamada — usando exatamente a mesma logica LATERAL JOIN
--    do dashboard_dre_aggregate e do dashboard_dre_drilldown. Serve como
--    "fonte unica da verdade" para confirmar o que o sistema deveria estar
--    mostrando agora. Util tanto para diagnostico manual quanto para
--    auto-deteccao no cron.
--
-- 2) dashboard_dre_unmapped_entries_audit: lista entries com category_code
--    nao nulo cujo LATERAL JOIN nao encontra mapeamento. Esses lancamentos
--    ficam invisiveis no dashboard (sem dre_account_id) — sao "dinheiro
--    perdido" do ponto de vista do relatorio. Causa principal de receitas
--    ou despesas que aparecem no extrato Omie mas nao na DRE.
--
-- Nenhum dos dois RPCs modifica dados.
-- =============================================================================

create or replace function public.dashboard_dre_consistency_check(
  p_company_ids uuid[],
  p_date_from date,
  p_date_to date
)
returns table (
  company_id uuid,
  company_name text,
  dre_account_id uuid,
  dre_account_code text,
  dre_account_name text,
  amount numeric,
  entry_count bigint,
  oldest_entry timestamptz,
  newest_entry timestamptz
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
      fe.created_at,
      mapping.dre_account_id
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
  )
  select
    m.company_id,
    c.name as company_name,
    m.dre_account_id,
    a.code as dre_account_code,
    a.name as dre_account_name,
    sum(m.value)::numeric as amount,
    count(*)::bigint as entry_count,
    min(m.created_at) as oldest_entry,
    max(m.created_at) as newest_entry
  from mapped m
  join public.companies c on c.id = m.company_id
  join public.dre_accounts a on a.id = m.dre_account_id
  group by m.company_id, c.name, m.dre_account_id, a.code, a.name
  order by c.name, a.code;
$$;

grant execute on function public.dashboard_dre_consistency_check(uuid[], date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Lista entries que ficam invisiveis no dashboard porque a categoria Omie
-- nao tem mapeamento DRE configurado (nem company-specific nem global).
-- Esses entries aparecem no Omie mas nao em nenhuma linha da DRE — uma
-- causa frequente do sintoma "valor sumiu do dashboard".
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_dre_unmapped_entries_audit(
  p_company_ids uuid[],
  p_date_from date,
  p_date_to date
)
returns table (
  company_id uuid,
  company_name text,
  category_code text,
  category_name text,
  entry_count bigint,
  total_value numeric,
  oldest_payment date,
  newest_payment date
)
language sql
stable
security invoker
set search_path = public
as $$
  with unmapped as (
    select
      fe.company_id,
      fe.category_code,
      fe.category_name,
      fe.value,
      fe.payment_date
    from public.financial_entries fe
    left join lateral (
      select cm.dre_account_id
      from public.category_mapping cm
      where cm.omie_category_code = fe.category_code
        and (cm.company_id = fe.company_id or cm.company_id is null)
      order by cm.company_id nulls last
      limit 1
    ) mapping on true
    where fe.payment_date between p_date_from and p_date_to
      and fe.company_id = any(p_company_ids)
      and fe.category_code is not null
      and mapping.dre_account_id is null
  )
  select
    u.company_id,
    c.name as company_name,
    u.category_code,
    coalesce(max(u.category_name), '') as category_name,
    count(*)::bigint as entry_count,
    sum(u.value)::numeric as total_value,
    min(u.payment_date) as oldest_payment,
    max(u.payment_date) as newest_payment
  from unmapped u
  join public.companies c on c.id = u.company_id
  group by u.company_id, c.name, u.category_code
  order by c.name, sum(u.value) desc;
$$;

grant execute on function public.dashboard_dre_unmapped_entries_audit(uuid[], date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Helper para o Dashboard exibir "Ultima sincronizacao: HH:MM".
-- Retorna o maior finished_at entre os syncs de status='success' das empresas
-- selecionadas. Nulo se nenhum sync foi concluido com sucesso.
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_last_successful_sync(
  p_company_ids uuid[]
)
returns timestamptz
language sql
stable
security invoker
set search_path = public
as $$
  select max(finished_at)
  from public.sync_log
  where company_id = any(p_company_ids)
    and status = 'success'
    and finished_at is not null;
$$;

grant execute on function public.dashboard_last_successful_sync(uuid[]) to authenticated;
