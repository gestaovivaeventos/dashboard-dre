-- =============================================================================
-- Corrige a posição da conta DRE "7.5.6 Doações" para ficar dentro do grupo
-- "7.5 Outras Despesas". A conta foi criada na seed inicial
-- (20260317153000_dre_accounts_and_mapping.sql) sob o parent 7.5, mas o
-- realinhamento posterior (20260319173000_align_dre_structure_from_xlsx.sql)
-- não a manteve na lista canônica e resultou em ela aparecer fora do grupo
-- na tela "Estrutura DRE" das empresas.
--
-- Esta migration:
--   1. Garante que 7.5.6 exista com o nome canônico "Doações"
--   2. Reanexa parent_id à conta 7.5 (Outras Despesas)
--   3. Reativa a conta e padroniza nivel, ordem e tipo
-- =============================================================================

with parent as (
  select id
  from public.dre_accounts
  where code = '7.5'
),
upsert as (
  insert into public.dre_accounts (
    code, name, parent_id, level, type, is_summary, formula, sort_order, active
  )
  select
    '7.5.6',
    'Doações',
    parent.id,
    3,
    'despesa'::public.dre_account_type,
    false,
    null,
    6,
    true
  from parent
  on conflict (code) do update
  set
    name = excluded.name,
    parent_id = excluded.parent_id,
    level = excluded.level,
    type = excluded.type,
    is_summary = excluded.is_summary,
    formula = excluded.formula,
    sort_order = excluded.sort_order,
    active = excluded.active
)
select 1;
