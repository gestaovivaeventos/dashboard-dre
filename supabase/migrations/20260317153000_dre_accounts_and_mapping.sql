-- Hero DRE Dashboard - DRE structure and category mapping

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'dre_account_type'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.dre_account_type as enum ('receita', 'despesa', 'calculado', 'misto');
  end if;
end $$;

create table if not exists public.dre_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  parent_id uuid references public.dre_accounts(id) on delete restrict,
  level integer not null check (level >= 1),
  type public.dre_account_type not null,
  is_summary boolean not null default false,
  formula text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (not (type = 'calculado') or (is_summary = true and formula is not null))
);

create index if not exists dre_accounts_parent_sort_idx
  on public.dre_accounts(parent_id, sort_order, code);

create table if not exists public.category_mapping (
  id uuid primary key default gen_random_uuid(),
  omie_category_code text not null,
  omie_category_name text not null,
  dre_account_id uuid not null references public.dre_accounts(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);

create unique index if not exists category_mapping_unique_scope_idx
  on public.category_mapping(omie_category_code, dre_account_id, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index if not exists category_mapping_company_idx
  on public.category_mapping(company_id, dre_account_id);

alter table public.dre_accounts enable row level security;
alter table public.category_mapping enable row level security;

create policy "Read dre_accounts authenticated"
on public.dre_accounts
for select
to authenticated
using (true);

create policy "Write dre_accounts admin"
on public.dre_accounts
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Read category_mapping by permission"
on public.category_mapping
for select
to authenticated
using (
  public.is_admin()
  or public.is_hero_manager()
  or company_id is null
  or company_id in (
    select u.company_id
    from public.users u
    where u.id = auth.uid()
  )
);

create policy "Write category_mapping admin"
on public.category_mapping
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

with dre_seed(code, name, parent_code, type, is_summary, formula, sort_order) as (
  values
    ('1', 'Receita Operacional Bruta', null, 'receita', true, null, 1),
    ('1.1', 'Clientes - Servicos Prestados - Assessoria', '1', 'receita', false, null, 1),
    ('1.2', 'Clientes - Margem de Contribuicao de Eventos', '1', 'receita', false, null, 2),
    ('1.3', 'Clientes - Servicos Prestados - Cerimonial/Fee', '1', 'receita', false, null, 3),

    ('2', 'Outras Receitas', null, 'receita', true, null, 2),
    ('2.1', 'Reembolso de Despesas', '2', 'receita', false, null, 1),
    ('2.2', 'Rendimentos de Aplicacoes', '2', 'receita', false, null, 2),
    ('2.3', 'Devolucoes de Compras', '2', 'receita', false, null, 3),
    ('2.4', 'Receitas Ressarciveis', '2', 'receita', false, null, 4),

    ('3', 'Deducoes de Receita', null, 'despesa', true, null, 3),
    ('3.1', 'ISS', '3', 'despesa', false, null, 1),
    ('3.2', 'Simples Nacional (DAS)', '3', 'despesa', false, null, 2),
    ('3.3', 'Devolucoes de Vendas de Servicos Prestados', '3', 'despesa', false, null, 3),

    ('4', 'Receita Liquida', null, 'calculado', true, '1+2-3', 4),

    ('5', 'Custos com os Servicos Prestados', null, 'despesa', true, null, 5),
    ('5.1', 'Taxa de Publicidade', '5', 'despesa', false, null, 1),
    ('5.2', 'Royalties', '5', 'despesa', false, null, 2),
    ('5.3', 'Bonificacoes/Beneficios Clientes', '5', 'despesa', false, null, 3),
    ('5.4', 'Viagens, Hospedagens, Alimentacao', '5', 'despesa', false, null, 4),
    ('5.5', 'Mao de Obra Eventos', '5', 'despesa', false, null, 5),
    ('5.6', 'Comissoes Comercial', '5', 'despesa', false, null, 6),
    ('5.7', 'Comissoes Relacionamento', '5', 'despesa', false, null, 7),
    ('5.8', 'Receitas Ressarciveis - Fundos', '5', 'despesa', false, null, 8),
    ('5.9', 'Despesas Ressarciveis - Fundos', '5', 'despesa', false, null, 9),
    ('5.10', 'Operacao com prejuizo', '5', 'despesa', false, null, 10),

    ('6', 'Lucro Operacional Bruto', null, 'calculado', true, '4-5', 6),

    ('7', 'Despesas Operacionais', null, 'despesa', true, null, 7),
    ('7.1', 'Vendas e Marketing', '7', 'despesa', true, null, 1),
    ('7.1.1', 'Marketing', '7.1', 'despesa', false, null, 1),
    ('7.1.2', 'Captacao de Clientes', '7.1', 'despesa', false, null, 2),

    ('7.2', 'Pessoal', '7', 'despesa', true, null, 2),
    ('7.2.1', 'Salarios', '7.2', 'despesa', false, null, 1),
    ('7.2.2', 'Ferias', '7.2', 'despesa', false, null, 2),
    ('7.2.3', 'Rescisoes', '7.2', 'despesa', false, null, 3),
    ('7.2.4', '13o Salario', '7.2', 'despesa', false, null, 4),
    ('7.2.5', 'INSS', '7.2', 'despesa', false, null, 5),
    ('7.2.6', 'FGTS', '7.2', 'despesa', false, null, 6),
    ('7.2.7', 'IRRF', '7.2', 'despesa', false, null, 7),
    ('7.2.8', 'Pensao Alimenticia', '7.2', 'despesa', false, null, 8),
    ('7.2.9', 'Assistencia Medica', '7.2', 'despesa', false, null, 9),
    ('7.2.10', 'Vale Transporte', '7.2', 'despesa', false, null, 10),
    ('7.2.11', 'Beneficios Flexiveis', '7.2', 'despesa', false, null, 11),
    ('7.2.12', 'Seguro de Vida', '7.2', 'despesa', false, null, 12),
    ('7.2.13', 'Outros Beneficios', '7.2', 'despesa', false, null, 13),
    ('7.2.14', 'Endomarketing', '7.2', 'despesa', false, null, 14),
    ('7.2.15', 'Treinamentos', '7.2', 'despesa', false, null, 15),
    ('7.2.16', 'Outros', '7.2', 'despesa', false, null, 16),
    ('7.2.17', 'Pro Labore', '7.2', 'despesa', false, null, 17),
    ('7.2.18', 'PJ', '7.2', 'despesa', false, null, 18),
    ('7.2.19', 'Variavel', '7.2', 'despesa', false, null, 19),
    ('7.2.20', 'Bonus Socio', '7.2', 'despesa', false, null, 20),

    ('7.3', 'Administrativas', '7', 'despesa', true, null, 3),
    ('7.3.1', 'Aluguel', '7.3', 'despesa', false, null, 1),
    ('7.3.2', 'Condominio', '7.3', 'despesa', false, null, 2),
    ('7.3.3', 'Agua', '7.3', 'despesa', false, null, 3),
    ('7.3.4', 'Energia', '7.3', 'despesa', false, null, 4),
    ('7.3.5', 'Telefonia', '7.3', 'despesa', false, null, 5),
    ('7.3.6', 'Manutencao', '7.3', 'despesa', false, null, 6),
    ('7.3.7', 'Seguros', '7.3', 'despesa', false, null, 7),
    ('7.3.8', 'IPTU', '7.3', 'despesa', false, null, 8),
    ('7.3.9', 'Contabilidade', '7.3', 'despesa', false, null, 9),
    ('7.3.10', 'Juridico', '7.3', 'despesa', false, null, 10),
    ('7.3.11', 'Seguranca', '7.3', 'despesa', false, null, 11),
    ('7.3.12', 'Taxas', '7.3', 'despesa', false, null, 12),
    ('7.3.13', 'Consultorias', '7.3', 'despesa', false, null, 13),
    ('7.3.14', 'Servicos HERO', '7.3', 'despesa', false, null, 14),
    ('7.3.15', 'Assessoria', '7.3', 'despesa', false, null, 15),
    ('7.3.16', 'Veiculos', '7.3', 'despesa', false, null, 16),
    ('7.3.17', 'Materiais', '7.3', 'despesa', false, null, 17),
    ('7.3.18', 'Outras', '7.3', 'despesa', false, null, 18),
    ('7.3.19', 'Softwares', '7.3', 'despesa', false, null, 19),
    ('7.3.20', 'Fretes', '7.3', 'despesa', false, null, 20),

    ('7.4', 'Financeiras', '7', 'despesa', true, null, 4),
    ('7.4.1', 'Juros', '7.4', 'despesa', false, null, 1),
    ('7.4.2', 'Multas', '7.4', 'despesa', false, null, 2),
    ('7.4.3', 'Tarifas', '7.4', 'despesa', false, null, 3),
    ('7.4.4', 'IR Aplicacao', '7.4', 'despesa', false, null, 4),
    ('7.4.5', 'IOF Aplicacao', '7.4', 'despesa', false, null, 5),
    ('7.4.6', 'IOF', '7.4', 'despesa', false, null, 6),

    ('7.5', 'Outras', '7', 'despesa', true, null, 5),
    ('7.5.1', 'Adiantamentos', '7.5', 'despesa', false, null, 1),
    ('7.5.2', 'Indenizacoes', '7.5', 'despesa', false, null, 2),
    ('7.5.3', 'Tributos sobre NF', '7.5', 'despesa', false, null, 3),
    ('7.5.4', 'IRRF Servicos', '7.5', 'despesa', false, null, 4),
    ('7.5.5', 'Ressarciveis', '7.5', 'despesa', false, null, 5),
    ('7.5.6', 'Doacoes', '7.5', 'despesa', false, null, 6),

    ('8', 'Lucro ou Prejuizo Operacional', null, 'calculado', true, '6-7', 8),
    ('9', 'Receitas Nao Operacionais', null, 'receita', true, null, 9),
    ('10', 'Despesas Nao Operacionais', null, 'despesa', true, null, 10),
    ('11', 'Resultado do Exercicio', null, 'calculado', true, '8+9-10', 11),

    ('20', 'Emprestimos e Mutuos', null, 'misto', true, null, 20),
    ('20.1', 'Entradas', '20', 'receita', false, null, 1),
    ('20.2', 'Saidas', '20', 'despesa', false, null, 2),

    ('21', 'Investimentos', null, 'despesa', true, null, 21),
    ('22', 'Dividendos', null, 'despesa', true, null, 22),
    ('23', 'Aportes', null, 'receita', true, null, 23),

    ('24', 'Fluxo de Caixa', null, 'calculado', true, '24.1+24.2-24.3', 24),
    ('24.1', 'Saldo Inicial', '24', 'misto', false, null, 1),
    ('24.2', 'Entradas', '24', 'calculado', true, '1+2+9+20.1+23', 2),
    ('24.3', 'Saidas', '24', 'calculado', true, '3+5+7+10+20.2+21+22', 3),
    ('24.4', 'Saldo Final', '24', 'calculado', true, '24.1+24.2-24.3', 4)
),
upserted as (
  insert into public.dre_accounts (code, name, level, type, is_summary, formula, sort_order, active)
  select
    s.code,
    s.name,
    array_length(string_to_array(s.code, '.'), 1) as level,
    s.type::public.dre_account_type,
    s.is_summary,
    s.formula,
    s.sort_order,
    true
  from dre_seed s
  on conflict (code) do update
  set
    name = excluded.name,
    level = excluded.level,
    type = excluded.type,
    is_summary = excluded.is_summary,
    formula = excluded.formula,
    sort_order = excluded.sort_order,
    active = excluded.active
  returning id, code
)
update public.dre_accounts child
set parent_id = parent.id
from dre_seed seed
left join public.dre_accounts parent
  on parent.code = seed.parent_code
where child.code = seed.code;
