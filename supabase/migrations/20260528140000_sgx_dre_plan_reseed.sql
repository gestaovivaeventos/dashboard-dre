-- =============================================================================
-- SGX (Real Estate) — Reseed do plano DRE custom
-- =============================================================================
-- Migration anterior (20260528120000) era defensiva: so inseria linhas com
-- WHERE NOT EXISTS. Mas a SGX ja tinha um clone do plano global (criado por
-- fork-on-edit em alguma edicao previa pelo admin), entao o INSERT pulou
-- TUDO e a SGX ficou com nomes do plano global (Receita Operacional Bruta,
-- Receita Liquida, etc.) em vez da estrutura especifica da SGX.
--
-- Esta migration recoloca a SGX no estado correto:
--   1. Apaga TODAS as linhas atuais de dre_accounts com company_id = SGX
--      (e via CASCADE qualquer category_mapping apontando para elas)
--   2. Insere a estrutura completa da SGX do zero (codes 1..15, 108 contas)
--
-- Idempotente: pode rodar de novo sem efeito colateral (segundo run apaga
-- as linhas e re-insere identicas).
--
-- IMPORTANTE: como dre_accounts.parent_id usa ON DELETE RESTRICT, precisamos
-- nulificar parent_id antes do DELETE para evitar violacao de FK.
-- =============================================================================

DO $$
DECLARE
  v_company_id uuid;
  v_deleted integer;
BEGIN
  SELECT id INTO v_company_id
  FROM public.companies
  WHERE name = 'SGX'
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RAISE NOTICE 'Company SGX nao encontrada — pulando reseed do plano DRE.';
    RETURN;
  END IF;

  -- ============================================================================
  -- Cleanup: remove plano DRE atual da SGX (fork-clone do global ou outro).
  -- ============================================================================
  -- 1) Nulifica parent_id em todas as linhas da SGX para desarmar o
  --    ON DELETE RESTRICT do auto-FK parent_id.
  UPDATE public.dre_accounts
  SET parent_id = NULL
  WHERE company_id = v_company_id;

  -- 2) Deleta todas as linhas. CASCADE em category_mapping.dre_account_id
  --    remove automaticamente quaisquer mapeamentos apontando para essas linhas.
  --    (Tipicamente nao existem ainda nesse momento — sync nao foi re-rodado
  --    com a nova estrutura — mas e seguro mesmo se existirem.)
  DELETE FROM public.dre_accounts
  WHERE company_id = v_company_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE 'SGX reseed: % linhas antigas removidas de dre_accounts.', v_deleted;

  -- ============================================================================
  -- Reseed: insere a estrutura SGX completa.
  -- ============================================================================
  CREATE TEMP TABLE _sgx_dre_seed (
    code text NOT NULL,
    name text NOT NULL,
    parent_code text,
    type text NOT NULL,
    is_summary boolean NOT NULL,
    formula text,
    sort_order integer NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO _sgx_dre_seed (code, name, parent_code, type, is_summary, formula, sort_order) VALUES
    -- 1. Receita com locacao de imovel
    ('1',   'Receita com locação de imóvel',           NULL, 'receita', true, NULL, 1),
    ('1.1', 'TERRAZZO',                                '1',  'receita', false, NULL, 1),
    ('1.2', 'HUB 5º ANDAR',                            '1',  'receita', false, NULL, 2),
    ('1.3', 'PREDIO SÃO PEDRO',                        '1',  'receita', false, NULL, 3),
    ('1.4', 'CASA SANTA LUZIA - TORREOES 196',         '1',  'receita', false, NULL, 4),

    -- 2. Despesas com Imoveis Locados
    ('2',   'Despesas com Imóveis Locados',            NULL, 'despesa', true, NULL, 2),
    ('2.1', 'TERRAZZO',                                '2',  'despesa', false, NULL, 1),
    ('2.2', 'HUB 5º ANDAR',                            '2',  'despesa', false, NULL, 2),
    ('2.3', 'PREDIO SÃO PEDRO',                        '2',  'despesa', false, NULL, 3),
    ('2.4', 'CASA SANTA LUZIA - TORREOES 196',         '2',  'despesa', false, NULL, 4),

    -- 3. Resultado 1 - Locacoes
    ('3',   'Resultado 1 - Locações',                  NULL, 'calculado', true, '1-2', 3),

    -- 4. Outras Receitas
    ('4',   'Outras Receitas',                         NULL, 'receita', true, NULL, 4),
    ('4.1', 'Rendimentos de Aplicações',               '4',  'receita', false, NULL, 1),
    ('4.2', 'Devoluções de Compras de Serviços Prestados', '4', 'receita', false, NULL, 2),
    ('4.3', 'Adiantamento de Clientes',                '4',  'receita', false, NULL, 3),
    ('4.4', 'Reembolso de Despesas',                   '4',  'receita', false, NULL, 4),

    -- 5. Deducoes de Receita
    ('5',   'Deduções de Receita',                     NULL, 'despesa', true, NULL, 5),
    ('5.1', 'ISS',                                     '5',  'despesa', false, NULL, 1),
    ('5.2', 'ICMS',                                    '5',  'despesa', false, NULL, 2),
    ('5.3', 'IPI',                                     '5',  'despesa', false, NULL, 3),
    ('5.4', 'PIS',                                     '5',  'despesa', false, NULL, 4),
    ('5.5', 'COFINS',                                  '5',  'despesa', false, NULL, 5),
    ('5.6', 'Devoluções de Vendas de Serviços Prestados', '5', 'despesa', false, NULL, 6),

    -- 6. Lucro Operacional Bruto
    ('6',   'Lucro Operacional Bruto',                 NULL, 'calculado', true, '3+4-5', 6),

    -- 7. Despesas Operacionais
    ('7',   'Despesas Operacionais',                   NULL, 'despesa', true, NULL, 7),

    -- 7.1 Despesas de Vendas e Marketing
    ('7.1',   'Despesas de Vendas e Marketing',        '7',   'despesa', true, NULL, 1),
    ('7.1.1', 'Comissões',                             '7.1', 'despesa', false, NULL, 1),
    ('7.1.2', 'Marketing',                             '7.1', 'despesa', false, NULL, 2),
    ('7.1.3', 'Despesas de Viagens',                   '7.1', 'despesa', false, NULL, 3),
    ('7.1.4', 'Bonificações',                          '7.1', 'despesa', false, NULL, 4),

    -- 7.2 Despesas com Pessoal
    ('7.2',    'Despesas com Pessoal',                 '7',   'despesa', true, NULL, 2),
    ('7.2.1',  'Salários',                             '7.2', 'despesa', false, NULL, 1),
    ('7.2.2',  'Adiantamento',                         '7.2', 'despesa', false, NULL, 2),
    ('7.2.3',  'Férias',                               '7.2', 'despesa', false, NULL, 3),
    ('7.2.4',  'Rescisões',                            '7.2', 'despesa', false, NULL, 4),
    ('7.2.5',  '13º Salário',                          '7.2', 'despesa', false, NULL, 5),
    ('7.2.6',  'INSS',                                 '7.2', 'despesa', false, NULL, 6),
    ('7.2.7',  'FGTS',                                 '7.2', 'despesa', false, NULL, 7),
    ('7.2.8',  'IRRF Sobre Folha',                     '7.2', 'despesa', false, NULL, 8),
    ('7.2.9',  'Pensão Alimentícia',                   '7.2', 'despesa', false, NULL, 9),
    ('7.2.10', 'Assistência Médica',                   '7.2', 'despesa', false, NULL, 10),
    ('7.2.11', 'Vale Transporte / Mobilidade',         '7.2', 'despesa', false, NULL, 11),
    ('7.2.12', 'Benefícios Flexíveis',                 '7.2', 'despesa', false, NULL, 12),
    ('7.2.13', 'Seguro de Vida',                       '7.2', 'despesa', false, NULL, 13),
    ('7.2.14', 'Outros Benefícios',                    '7.2', 'despesa', false, NULL, 14),
    ('7.2.15', 'Salários PJ',                          '7.2', 'despesa', false, NULL, 15),
    ('7.2.16', 'Endomarketing',                        '7.2', 'despesa', false, NULL, 16),
    ('7.2.17', 'Capacitação e Treinamentos',           '7.2', 'despesa', false, NULL, 17),
    ('7.2.18', 'Outros (Contribuição Sindical, PCMO, Exames)', '7.2', 'despesa', false, NULL, 18),
    ('7.2.19', 'Pró Labore Sócios',                    '7.2', 'despesa', false, NULL, 19),

    -- 7.3 Despesas Administrativas
    ('7.3',    'Despesas Administrativas',             '7',   'despesa', true, NULL, 3),
    ('7.3.1',  'Aluguel',                              '7.3', 'despesa', false, NULL, 1),
    ('7.3.2',  'Condomínio',                           '7.3', 'despesa', false, NULL, 2),
    ('7.3.3',  'Água e Esgoto',                        '7.3', 'despesa', false, NULL, 3),
    ('7.3.4',  'Energia Elétrica',                     '7.3', 'despesa', false, NULL, 4),
    ('7.3.5',  'Telefonia',                            '7.3', 'despesa', false, NULL, 5),
    ('7.3.6',  'Manutenção de Imobilizado',            '7.3', 'despesa', false, NULL, 6),
    ('7.3.7',  'Seguros',                              '7.3', 'despesa', false, NULL, 7),
    ('7.3.8',  'IPTU',                                 '7.3', 'despesa', false, NULL, 8),
    ('7.3.9',  'Contabilidade',                        '7.3', 'despesa', false, NULL, 9),
    ('7.3.10', 'Advogados',                            '7.3', 'despesa', false, NULL, 10),
    ('7.3.11', 'Segurança',                            '7.3', 'despesa', false, NULL, 11),
    ('7.3.12', 'Taxas Diversas',                       '7.3', 'despesa', false, NULL, 12),
    ('7.3.13', 'Assessoria Administrativa',            '7.3', 'despesa', false, NULL, 13),
    ('7.3.14', 'Fretes e Transportes em Geral',        '7.3', 'despesa', false, NULL, 14),
    ('7.3.15', 'Material Limpeza / Escritório / Mercado / Padaria', '7.3', 'despesa', false, NULL, 15),
    ('7.3.16', 'Softwares, Sistemas e Servidores',     '7.3', 'despesa', false, NULL, 16),
    ('7.3.17', 'Outras Despesas Administrativas',      '7.3', 'despesa', false, NULL, 17),

    -- 7.4 Despesas Financeiras / Bancos
    ('7.4',   'Despesas Financeiras / Bancos',         '7',   'despesa', true, NULL, 4),
    ('7.4.1', 'Juros sobre Empréstimos',               '7.4', 'despesa', false, NULL, 1),
    ('7.4.2', 'Multas',                                '7.4', 'despesa', false, NULL, 2),
    ('7.4.3', 'Tarifas Bancárias',                     '7.4', 'despesa', false, NULL, 3),
    ('7.4.4', 'IOF',                                   '7.4', 'despesa', false, NULL, 4),
    ('7.4.5', 'IR s/ Aplicação Financeira',            '7.4', 'despesa', false, NULL, 5),
    ('7.4.6', 'IOF s/ Aplicação Financeira',           '7.4', 'despesa', false, NULL, 6),

    -- 7.5 Impostos e Taxas
    ('7.5',   'Impostos e Taxas',                      '7',   'despesa', true, NULL, 5),
    ('7.5.1', 'PIS/COFINS/IR/CSLL Sobre Nota Fiscal',  '7.5', 'despesa', false, NULL, 1),
    ('7.5.2', 'IRRF Sobre Nota Fiscal',                '7.5', 'despesa', false, NULL, 2),
    ('7.5.3', 'IRRF Sobre Aluguel',                    '7.5', 'despesa', false, NULL, 3),

    -- 7.6 Outras Despesas
    ('7.6',   'Outras Despesas',                       '7',   'despesa', true, NULL, 6),
    ('7.6.1', 'Compra de Serviços',                    '7.6', 'despesa', false, NULL, 1),
    ('7.6.2', 'Adiantamento a Fornecedores',           '7.6', 'despesa', false, NULL, 2),

    -- 8. Resultado antes do IR e CSLL
    ('8',   'Resultado antes do IR e CSLL',            NULL, 'calculado', true, '6-7', 8),

    -- 9. IRPJ
    ('9',   'IRPJ',                                    NULL, 'despesa', false, NULL, 9),

    -- 10. Contribuicao Social
    ('10',  'Contribuição Social',                     NULL, 'despesa', false, NULL, 10),

    -- 11. Resultado 2 - Locacao + Operacional
    ('11',  'Resultado 2 - Locação + Operacional',     NULL, 'calculado', true, '8-9-10', 11),

    -- 12. Receitas Projetos
    ('12',   'Receitas Projetos',                      NULL,  'receita', true, NULL, 12),
    ('12.1', 'BR 040',                                 '12',  'receita', false, NULL, 1),
    ('12.2', 'EMPREENDIMENTO GRAMINHA',                '12',  'receita', false, NULL, 2),
    ('12.3', 'EMPREENDIMENTO MARABO',                  '12',  'receita', false, NULL, 3),
    ('12.4', 'EMPREENDIMENTO MIRANTE PARQUE GUARANI',  '12',  'receita', false, NULL, 4),
    ('12.5', 'EMPREENDIMENTO RML',                     '12',  'receita', false, NULL, 5),
    ('12.6', 'LOTEAMENTO BARBACENA',                   '12',  'receita', false, NULL, 6),
    ('12.7', 'TAMISA BOM PASTOR',                      '12',  'receita', false, NULL, 7),
    ('12.8', 'WALERY',                                 '12',  'receita', false, NULL, 8),
    ('12.9', 'JARDIM DAS ACACIAS',                     '12',  'receita', false, NULL, 9),

    -- 13. Despesas Projetos
    ('13',   'Despesas Projetos',                      NULL,  'despesa', true, NULL, 13),
    ('13.1', 'BR 040',                                 '13',  'despesa', false, NULL, 1),
    ('13.2', 'EMPREENDIMENTO GRAMINHA',                '13',  'despesa', false, NULL, 2),
    ('13.3', 'EMPREENDIMENTO MARABO',                  '13',  'despesa', false, NULL, 3),
    ('13.4', 'EMPREENDIMENTO MIRANTE PARQUE GUARANI',  '13',  'despesa', false, NULL, 4),
    ('13.5', 'EMPREENDIMENTO RML',                     '13',  'despesa', false, NULL, 5),
    ('13.6', 'LOTEAMENTO BARBACENA',                   '13',  'despesa', false, NULL, 6),
    ('13.7', 'TAMISA BOM PASTOR',                      '13',  'despesa', false, NULL, 7),
    ('13.8', 'WALERY',                                 '13',  'despesa', false, NULL, 8),
    ('13.9', 'JARDIM DAS ACACIAS',                     '13',  'despesa', false, NULL, 9),

    -- 14. Resultado 3 - Projetos
    ('14',  'Resultado 3 - Projetos',                  NULL, 'calculado', true, '12-13', 14),

    -- 15. Resultado 4 - Locacao + Operacional + Projetos
    ('15',  'Resultado 4 - Locação + Operacional + Projetos', NULL, 'calculado', true, '11+14', 15);

  -- Insert: agora sem WHERE NOT EXISTS, ja que apagamos tudo antes.
  INSERT INTO public.dre_accounts (
    company_id, code, name, level, type, is_summary, formula, sort_order, active
  )
  SELECT
    v_company_id,
    s.code,
    s.name,
    array_length(string_to_array(s.code, '.'), 1),
    s.type::public.dre_account_type,
    s.is_summary,
    s.formula,
    s.sort_order,
    true
  FROM _sgx_dre_seed s;

  -- Update: wire up parent_id por code (so dentro do escopo da SGX).
  UPDATE public.dre_accounts c
  SET parent_id = p.id
  FROM _sgx_dre_seed s
  INNER JOIN public.dre_accounts p
    ON p.company_id = v_company_id AND p.code = s.parent_code
  WHERE c.company_id = v_company_id
    AND c.code = s.code
    AND s.parent_code IS NOT NULL;

  RAISE NOTICE 'SGX reseed: % contas DRE inseridas com sucesso.',
    (SELECT count(*) FROM public.dre_accounts WHERE company_id = v_company_id);
END $$;
