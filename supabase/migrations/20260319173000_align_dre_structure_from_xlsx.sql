-- Alinha a estrutura principal da DRE (1..11) ao arquivo "estrutura dre.xlsx"

with dre_seed(code, name, parent_code, type, is_summary, formula, sort_order) as (
  values
    ('1', 'Receita Operacional Bruta', null, 'receita', true, null, 1),
    ('1.1', 'Clientes - Serviços Prestados - Assessoria', '1', 'receita', false, null, 1),
    ('1.2', 'Clientes - Margem de Contribuição de Eventos', '1', 'receita', false, null, 2),
    ('1.3', 'Clientes - Serviços Prestados - Cerimonial/Fee', '1', 'receita', false, null, 3),

    ('2', 'Outras Receitas', null, 'receita', true, null, 2),
    ('2.1', 'Reembolso de Despesas', '2', 'receita', false, null, 1),
    ('2.2', 'Rendimentos de Aplicações', '2', 'receita', false, null, 2),
    ('2.3', 'Devoluções de Compras', '2', 'receita', false, null, 3),
    ('2.4', 'Receitas Ressarciveis', '2', 'receita', false, null, 4),

    ('3', 'Deduções de Receita', null, 'despesa', true, null, 3),
    ('3.1', 'ISS', '3', 'despesa', false, null, 1),
    ('3.2', 'Simples Nacional (DAS)', '3', 'despesa', false, null, 2),
    ('3.3', 'Devoluções de Vendas de Serviços Prestados', '3', 'despesa', false, null, 3),

    ('4', 'Receita Líquida', null, 'calculado', true, '1+2-3', 4),

    ('5', 'Custos com os Serviços Prestados', null, 'despesa', true, null, 5),
    ('5.1', 'Taxa de Publicidade', '5', 'despesa', false, null, 1),
    ('5.2', 'Royalties', '5', 'despesa', false, null, 2),
    ('5.3', 'Custos Serviços Prestados - Bonificações/Benefícios Clientes', '5', 'despesa', false, null, 3),
    ('5.4', 'Custos Serviços Prestados - Viagens, Hospedagens, Alimentação', '5', 'despesa', false, null, 4),
    ('5.5', 'Custo Serviços Prestados - Mão de Obra (Produtores, Recepcionistas...)', '5', 'despesa', false, null, 5),
    ('5.6', 'Comissões Comercial', '5', 'despesa', false, null, 6),
    ('5.7', 'Comissões Relacionamento', '5', 'despesa', false, null, 7),
    ('5.8', 'Receitas Ressarciveis - Fundos', '5', 'despesa', false, null, 8),
    ('5.9', 'Despesas Ressarcíveis - Fundos', '5', 'despesa', false, null, 9),
    ('5.10', 'Operação com prejuízo', '5', 'despesa', false, null, 10),

    ('6', 'LUCRO OPERACIONAL BRUTO', null, 'calculado', true, '4-5', 6),

    ('7', 'Despesas Operacionais', null, 'despesa', true, null, 7),
    ('7.1', 'Despesas de Vendas e Marketing', '7', 'despesa', true, null, 1),
    ('7.1.1', 'Marketing', '7.1', 'despesa', false, null, 1),
    ('7.1.2', 'Despesa de Captação de Clientes', '7.1', 'despesa', false, null, 2),

    ('7.2', 'Despesas com Pessoal', '7', 'despesa', true, null, 2),
    ('7.2.1', 'Salários', '7.2', 'despesa', false, null, 1),
    ('7.2.2', 'Férias', '7.2', 'despesa', false, null, 2),
    ('7.2.3', 'Rescisões', '7.2', 'despesa', false, null, 3),
    ('7.2.4', '13º Salário', '7.2', 'despesa', false, null, 4),
    ('7.2.5', 'INSS', '7.2', 'despesa', false, null, 5),
    ('7.2.6', 'FGTS', '7.2', 'despesa', false, null, 6),
    ('7.2.7', 'IRRF', '7.2', 'despesa', false, null, 7),
    ('7.2.8', 'Pensão Alimentícia', '7.2', 'despesa', false, null, 8),
    ('7.2.9', 'Assistência Médica', '7.2', 'despesa', false, null, 9),
    ('7.2.10', 'Vale Transporte / Mobilidade', '7.2', 'despesa', false, null, 10),
    ('7.2.11', 'Benefícios Flexíveis', '7.2', 'despesa', false, null, 11),
    ('7.2.12', 'Seguro de Vida', '7.2', 'despesa', false, null, 12),
    ('7.2.13', 'Outros Benefícios', '7.2', 'despesa', false, null, 13),
    ('7.2.14', 'Ações Endomarketing', '7.2', 'despesa', false, null, 14),
    ('7.2.15', 'Capacitação e Treinamentos', '7.2', 'despesa', false, null, 15),
    ('7.2.16', 'Outros ( Contribuição Sindical - PCMO, Exames...)', '7.2', 'despesa', false, null, 16),
    ('7.2.17', 'Pró Labore Sócios', '7.2', 'despesa', false, null, 17),
    ('7.2.18', 'Contratos com Pessoas Jurídicas', '7.2', 'despesa', false, null, 18),
    ('7.2.19', 'Remuneração Variável', '7.2', 'despesa', false, null, 19),
    ('7.2.20', 'Bônus Sócio', '7.2', 'despesa', false, null, 20),

    ('7.3', 'Despesas Administrativas', '7', 'despesa', true, null, 3),
    ('7.3.1', 'Aluguel', '7.3', 'despesa', false, null, 1),
    ('7.3.2', 'Condomínio', '7.3', 'despesa', false, null, 2),
    ('7.3.3', 'Água e Esgoto', '7.3', 'despesa', false, null, 3),
    ('7.3.4', 'Energia Elétrica', '7.3', 'despesa', false, null, 4),
    ('7.3.5', 'Telefonia', '7.3', 'despesa', false, null, 5),
    ('7.3.6', 'Manutenção de Imobilizado', '7.3', 'despesa', false, null, 6),
    ('7.3.7', 'Seguros', '7.3', 'despesa', false, null, 7),
    ('7.3.8', 'IPTU', '7.3', 'despesa', false, null, 8),
    ('7.3.9', 'Contabilidade', '7.3', 'despesa', false, null, 9),
    ('7.3.10', 'Advogados', '7.3', 'despesa', false, null, 10),
    ('7.3.11', 'Segurança', '7.3', 'despesa', false, null, 11),
    ('7.3.12', 'Taxas Diversas', '7.3', 'despesa', false, null, 12),
    ('7.3.13', 'Consultorias e Treinamentos', '7.3', 'despesa', false, null, 13),
    ('7.3.14', 'Despesa com Serviços HERO', '7.3', 'despesa', false, null, 14),
    ('7.3.15', 'Assessoria Administrativa', '7.3', 'despesa', false, null, 15),
    ('7.3.16', 'Despesas com veículos', '7.3', 'despesa', false, null, 16),
    ('7.3.17', 'Material Limpeza / Escritório / Mercado / Padaria', '7.3', 'despesa', false, null, 17),
    ('7.3.18', 'Outras Despesas Administrativas', '7.3', 'despesa', false, null, 18),
    ('7.3.19', 'Softwares, Sistemas e Servidores', '7.3', 'despesa', false, null, 19),
    ('7.3.20', 'Fretes e Transportes em Geral', '7.3', 'despesa', false, null, 20),

    ('7.4', 'Despesas Financeiras / Bancos', '7', 'despesa', true, null, 4),
    ('7.4.1', 'Juros sobre Empréstimos', '7.4', 'despesa', false, null, 1),
    ('7.4.2', 'Multas', '7.4', 'despesa', false, null, 2),
    ('7.4.3', 'Tarifas Bancárias', '7.4', 'despesa', false, null, 3),
    ('7.4.4', 'IR s/ Aplicação Financeira', '7.4', 'despesa', false, null, 4),
    ('7.4.5', 'IOF s/ Aplicação Financeira', '7.4', 'despesa', false, null, 5),
    ('7.4.6', 'IOF', '7.4', 'despesa', false, null, 6),

    ('7.5', 'Outras Despesas', '7', 'despesa', true, null, 5),
    ('7.5.1', 'Adiantamento a Fornecedores', '7.5', 'despesa', false, null, 1),
    ('7.5.2', 'Indenizações Judiciais', '7.5', 'despesa', false, null, 2),
    ('7.5.3', 'PIS/COFINS/IR/CSLL Sobre Nota Fiscal', '7.5', 'despesa', false, null, 3),
    ('7.5.4', 'IRRF sobre Seviços Tomados', '7.5', 'despesa', false, null, 4),
    ('7.5.5', 'Despesas Ressarcíveis', '7.5', 'despesa', false, null, 5),

    ('8', 'Lucro ou Prejuízo Operacional', null, 'calculado', true, '6-7', 8),
    ('9', 'Receitas Não Operacionais', null, 'receita', true, null, 9),
    ('10', 'Despesas Não Operacionais', null, 'despesa', true, null, 10),
    ('11', 'Resultado do Exercício', null, 'calculado', true, '8+9-10', 11)
),
dedup_seed as (
  select distinct on (code)
    code,
    name,
    parent_code,
    type,
    is_summary,
    formula,
    sort_order
  from dre_seed
  order by code, sort_order
),
updated as (
  update public.dre_accounts d
  set
    name = s.name,
    level = array_length(string_to_array(s.code, '.'), 1),
    type = s.type::public.dre_account_type,
    is_summary = s.is_summary,
    formula = s.formula,
    sort_order = s.sort_order,
    active = true
  from dedup_seed s
  where d.code = s.code
  returning d.id, d.code
),
inserted as (
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
  from dedup_seed s
  where not exists (
    select 1
    from public.dre_accounts d
    where d.code = s.code
  )
  returning id, code
)
update public.dre_accounts child
set parent_id = parent.id
from dedup_seed seed
left join public.dre_accounts parent
  on parent.code = seed.parent_code
where child.code = seed.code;

update public.dre_accounts
set active = false
where split_part(code, '.', 1) ~ '^[0-9]+$'
  and split_part(code, '.', 1)::int between 1 and 11
  and code not in (
    select code
    from (
      values
        ('1'), ('1.1'), ('1.2'), ('1.3'),
        ('2'), ('2.1'), ('2.2'), ('2.3'), ('2.4'),
        ('3'), ('3.1'), ('3.2'), ('3.3'),
        ('4'),
        ('5'), ('5.1'), ('5.2'), ('5.3'), ('5.4'), ('5.5'), ('5.6'), ('5.7'), ('5.8'), ('5.9'), ('5.10'),
        ('6'),
        ('7'),
        ('7.1'), ('7.1.1'), ('7.1.2'),
        ('7.2'), ('7.2.1'), ('7.2.2'), ('7.2.3'), ('7.2.4'), ('7.2.5'), ('7.2.6'), ('7.2.7'), ('7.2.8'),
        ('7.2.9'), ('7.2.10'), ('7.2.11'), ('7.2.12'), ('7.2.13'), ('7.2.14'), ('7.2.15'), ('7.2.16'),
        ('7.2.17'), ('7.2.18'), ('7.2.19'), ('7.2.20'),
        ('7.3'), ('7.3.1'), ('7.3.2'), ('7.3.3'), ('7.3.4'), ('7.3.5'), ('7.3.6'), ('7.3.7'), ('7.3.8'),
        ('7.3.9'), ('7.3.10'), ('7.3.11'), ('7.3.12'), ('7.3.13'), ('7.3.14'), ('7.3.15'), ('7.3.16'),
        ('7.3.17'), ('7.3.18'), ('7.3.19'), ('7.3.20'),
        ('7.4'), ('7.4.1'), ('7.4.2'), ('7.4.3'), ('7.4.4'), ('7.4.5'), ('7.4.6'),
        ('7.5'), ('7.5.1'), ('7.5.2'), ('7.5.3'), ('7.5.4'), ('7.5.5'),
        ('8'), ('9'), ('10'), ('11')
    ) as keep(code)
  );
