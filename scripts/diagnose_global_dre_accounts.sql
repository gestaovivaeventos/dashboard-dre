-- DIAGNOSTICO: identifica o que mudou no plano global de dre_accounts
-- comparado a seed original (migration 20260317153000).
-- Este script NAO altera nada — apenas SELECT.
-- Cole no SQL Editor do Supabase e clique Run.

with seed(code, name, parent_code, type, is_summary, formula, sort_order) as (
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
current_global as (
  select code, name, type::text as type, is_summary, formula, sort_order
  from public.dre_accounts
  where company_id is null
)
-- 1) Contas que estao no plano global atual mas NAO existiam na seed original
--    (provavelmente criadas via "Criar nova conta"):
select 'NOVA (nao existia na seed)' as status,
       cg.code, cg.name, cg.type, cg.is_summary, cg.formula, cg.sort_order
from current_global cg
left join seed s on s.code = cg.code
where s.code is null

union all

-- 2) Contas que existiam na seed mas estao FALTANDO no plano global atual
--    (provavelmente deletadas):
select 'DELETADA (faltando agora)' as status,
       s.code, s.name, s.type, s.is_summary, s.formula, s.sort_order
from seed s
left join current_global cg on cg.code = s.code
where cg.code is null

union all

-- 3) Contas que existem em ambos mas com nome/tipo/formula DIFERENTES
--    (provavelmente editadas):
select 'EDITADA (campos diferem)' as status,
       cg.code,
       cg.name || ' [seed: ' || s.name || ']' as name,
       cg.type || coalesce(' [seed: ' || s.type || ']', '') as type,
       cg.is_summary,
       coalesce(cg.formula, '<null>') || ' [seed: ' || coalesce(s.formula, '<null>') || ']' as formula,
       cg.sort_order
from current_global cg
join seed s on s.code = cg.code
where cg.name <> s.name
   or cg.type <> s.type
   or cg.is_summary <> s.is_summary
   or coalesce(cg.formula, '') <> coalesce(s.formula, '')

order by 2;
