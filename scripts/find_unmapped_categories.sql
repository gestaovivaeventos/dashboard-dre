-- =============================================================================
-- AUDITORIA: categorias Omie com lançamentos mas SEM mapeamento ativo
-- =============================================================================
-- Lista categorias Omie que aparecem em financial_entries mas que hoje nao
-- tem mapeamento valido (nem company-specific, nem global). Provavelmente
-- inclui todas as categorias que estavam mapeadas para as contas DRE
-- deletadas e foram cascade-deletadas junto.
--
-- Mostra por empresa (pra voce ir em Mapeamento de cada empresa do segmento)
-- e por categoria (codigo + nome Omie).
--
-- Apenas SELECT — nao altera nada.
-- =============================================================================

with entries_categories as (
  -- Categorias Omie que aparecem nos lancamentos
  select
    fe.company_id,
    fe.category_code,
    -- Pega o nome Omie mais comum (caso varie entre lancamentos)
    mode() within group (order by fe.category_name) as omie_name,
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
    -- Mapeamento company-specific
    select 1
    from public.category_mapping cm
    where cm.omie_category_code = ec.category_code
      and cm.company_id = ec.company_id
  )
  and not exists (
    -- Mapeamento global fallback
    select 1
    from public.category_mapping cm
    where cm.omie_category_code = ec.category_code
      and cm.company_id is null
  )
)
select
  c.name as empresa,
  u.category_code as codigo_omie,
  u.omie_name as nome_omie,
  u.entry_count as qtd_lancamentos,
  to_char(u.total_value, 'FM999G999G990D00') as valor_total,
  u.first_entry as primeiro_lancamento,
  u.last_entry as ultimo_lancamento
from unmapped u
join public.companies c on c.id = u.company_id
order by c.name, u.category_code;
