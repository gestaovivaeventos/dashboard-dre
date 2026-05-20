-- Lista todos os planos DRE customizados (company_id IS NOT NULL)
-- e quantas contas cada um tem.
-- Apenas SELECT, nao altera nada.

select
  c.name as empresa,
  count(d.id) as qtd_contas_custom,
  string_agg(distinct d.code, ', ' order by d.code) filter (where d.level = 1) as contas_topo
from public.companies c
join public.dre_accounts d on d.company_id = c.id
group by c.name
order by c.name;

-- Tambem mostra os codigos onde plano custom REDEFINE algo do plano global
-- (mesmos codigos com nomes diferentes — provavel fonte de "fantasmas" no DRE)
select
  c.name as empresa,
  d.code,
  d.name as nome_custom,
  g.name as nome_global,
  case when d.name <> g.name then 'DIFERE - aparece como fantasma no DRE'
       else 'igual ao global - silencioso'
  end as observacao
from public.dre_accounts d
join public.companies c on c.id = d.company_id
left join public.dre_accounts g on g.code = d.code and g.company_id is null
order by c.name, d.code;
