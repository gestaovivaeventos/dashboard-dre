-- Diagnostico complementar:
-- 1) Estado dos filhos de 20 e 24 (existem? sao orfaos? quem e o pai?)
-- 2) Estado atual de account 5 (formula, type, is_summary)
-- 3) Listagem completa dos codigos globais existentes para validar
-- NAO altera nada. Apenas SELECT.

-- ============================================================
-- 1) Filhos de 20 e 24 — quem existe e qual o parent_id?
-- ============================================================
select
  'FILHOS_20_24' as section,
  d.code,
  d.name,
  d.parent_id,
  case
    when d.parent_id is null then '<sem pai>'
    else (select p.code || ' - ' || p.name from public.dre_accounts p where p.id = d.parent_id)
  end as parent_info,
  d.active,
  d.created_at
from public.dre_accounts d
where d.company_id is null
  and d.code in ('20', '20.1', '20.2', '21', '22', '23', '24', '24.1', '24.2', '24.3', '24.4')
order by d.code;

-- ============================================================
-- 2) Estado atual da conta 5
-- ============================================================
select
  'CONTA_5' as section,
  d.code,
  d.name,
  d.type::text,
  d.is_summary,
  d.formula,
  d.sort_order,
  d.active
from public.dre_accounts d
where d.company_id is null
  and d.code = '5';

-- ============================================================
-- 3) Contas customizadas (company_id != null) — quantas existem por empresa?
-- ============================================================
select
  'CUSTOM_PLANS' as section,
  c.name as company_name,
  count(d.id) as accounts_count
from public.companies c
join public.dre_accounts d on d.company_id = c.id
group by c.name
order by c.name;

-- ============================================================
-- 4) Mapeamentos atuais que apontam para contas 1.x, 20.x, 21, 22, 23, 24.x
--    (pra saber o que foi cascade-deletado quando voce deletou)
-- ============================================================
select
  'MAPEAMENTOS_RESTANTES' as section,
  d.code as dre_code,
  d.name as dre_name,
  count(cm.id) as mapping_count
from public.dre_accounts d
left join public.category_mapping cm on cm.dre_account_id = d.id
where d.company_id is null
  and (d.code like '1.%' or d.code in ('1') or d.code like '20%' or d.code in ('21','22','23') or d.code like '24%')
group by d.code, d.name
order by d.code;
