-- =============================================================================
-- AUDITORIA V2: categorias Omie desmapeadas + descricoes + flag de prioridade
-- =============================================================================
-- Mostra TODAS as categorias Omie com lancamentos mas sem mapeamento ativo,
-- junto com a descricao do catalogo Omie e uma flag indicando se a categoria
-- e CANDIDATA forte a "perda recente" (baseado no nome bater com as contas
-- DRE deletadas: Assessoria, Cerimonial/Fee, Emprestimos, Investimentos,
-- Dividendos, Aportes, Fluxo de Caixa).
--
-- Filtra ruido: exclui codigos `0.01.*` (transferencias internas entre contas
-- bancarias) que tipicamente nao precisam de mapeamento.
-- =============================================================================

with entries_categories as (
  select
    fe.company_id,
    fe.category_code,
    count(*) as entry_count,
    sum(fe.value) as total_value,
    min(fe.payment_date) as first_entry,
    max(fe.payment_date) as last_entry
  from public.financial_entries fe
  where fe.category_code is not null
  group by fe.company_id, fe.category_code
),
unmapped as (
  select ec.*
  from entries_categories ec
  where not exists (
    select 1 from public.category_mapping cm
    where cm.omie_category_code = ec.category_code
      and cm.company_id = ec.company_id
  )
  and not exists (
    select 1 from public.category_mapping cm
    where cm.omie_category_code = ec.category_code
      and cm.company_id is null
  )
),
enriched as (
  select
    c.name as empresa,
    u.category_code as codigo_omie,
    oc.description as nome_omie,
    u.entry_count as qtd_lancamentos,
    u.total_value,
    u.first_entry as primeiro_lancamento,
    u.last_entry as ultimo_lancamento,
    -- Heuristica de prioridade baseada no nome da categoria
    case
      when oc.description ilike '%assessoria%' then '1.1 (Assessoria)'
      when oc.description ilike '%cerimoni%' or oc.description ilike '%fee%' then '1.3 (Cerimonial/Fee)'
      when oc.description ilike '%emprest%' or oc.description ilike '%mutuo%' or oc.description ilike '%mútuo%' then '20 (Emprestimos/Mutuos)'
      when oc.description ilike '%financiamento%' then '20.2 (Saidas)'
      when oc.description ilike '%investimento%' then '21 (Investimentos)'
      when oc.description ilike '%dividendo%' then '22 (Dividendos)'
      when oc.description ilike '%aporte%' then '23 (Aportes)'
      when oc.description ilike '%fluxo%caixa%' or oc.description ilike '%saldo%' then '24 (Fluxo de Caixa)'
      else null
    end as candidata_dre_restaurada
  from unmapped u
  join public.companies c on c.id = u.company_id
  left join public.omie_categories oc
    on oc.company_id = u.company_id
   and oc.code = u.category_code
)
select
  empresa,
  codigo_omie,
  coalesce(nome_omie, '(sem catalogo)') as nome_omie,
  qtd_lancamentos,
  to_char(total_value, 'FM999G999G990D00') as valor_total,
  primeiro_lancamento,
  ultimo_lancamento,
  coalesce(candidata_dre_restaurada, '') as candidata_dre_restaurada
from enriched
where codigo_omie not like '0.01.%'  -- exclui transferencias internas
order by
  case when candidata_dre_restaurada is not null then 0 else 1 end,  -- candidatas primeiro
  empresa,
  total_value desc;
