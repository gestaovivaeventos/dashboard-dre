-- =============================================================================
-- Village (Real Estate) — Plano DRE custom dedicado (reseed)
-- =============================================================================
-- Cria a estrutura completa do DRE da Village como plano per-company a partir
-- do zero (sem fork-on-edit do plano global), seguindo o mesmo padrao da SGX e
-- da Feat. Plano EXCLUSIVO da Village: scoped por company_id, nao toca no plano
-- global nem em nenhuma outra empresa (incluindo a SGX, que e do mesmo segmento
-- Real Estate, mas tem company_id proprio).
--
-- Convencoes do motor do DRE respeitadas (src/lib/dashboard/dre.ts):
--   - code "4"  = Receita Operacional Liquida -> base dos percentuais (%).
--   - code "11" = Resultado Apos IR e CS      -> DRE_RESULTADO_EXERCICIO_CODE.
--
-- Hierarquia (codes 1..11), extraida da planilha de plano de contas da Village:
--   1   Receitas Diretas                       [sum]  (1.1..1.2)
--   2   Receitas Indiretas                     [sum]  (2.1..2.3)
--   3   Deducoes da Receita                    [sum]  (3.1..3.5)
--   4   Receita Operacional Liquida            [calc: 1+2-3]
--   5   Despesas Diretas                       [sum]  (5.1)
--   6   Lucro Operacional Bruto                [calc: 4-5]
--   7   Despesas Operacionais                  [sum]  (7.1..7.4 + filhos)
--   8   Resultado do Exercicio Antes IR e CS   [calc: 6-7]
--   9   IRPJ                                   [leaf]
--   10  Contribuicao Social                    [leaf]
--   11  Resultado Apos IR e CS                 [calc: 8-9-10]
--
-- Reseed (igual SGX): se a Village ja tiver um plano (clone do global por
-- fork-on-edit, ou outro), ele e removido antes — e via CASCADE quaisquer
-- category_mapping apontando para essas contas sao apagados (precisarao ser
-- remapeados para o novo plano). Idempotente: re-aplicar apaga e re-insere.
--
-- IMPORTANTE: parent_id usa ON DELETE RESTRICT, entao nulificamos parent_id
-- antes do DELETE para evitar violacao de FK.
-- =============================================================================

DO $$
DECLARE
  v_company_id uuid;
  v_deleted integer;
BEGIN
  SELECT id INTO v_company_id
  FROM public.companies
  WHERE name = 'Village'
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RAISE NOTICE 'Company Village nao encontrada — pulando seed do plano DRE.';
    RETURN;
  END IF;

  -- ============================================================================
  -- Cleanup: remove plano DRE atual da Village (se houver).
  -- ============================================================================
  UPDATE public.dre_accounts
  SET parent_id = NULL
  WHERE company_id = v_company_id;

  DELETE FROM public.dre_accounts
  WHERE company_id = v_company_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE 'Village reseed: % linhas antigas removidas de dre_accounts.', v_deleted;

  -- ============================================================================
  -- Reseed: estrutura completa da Village.
  -- ============================================================================
  CREATE TEMP TABLE _village_dre_seed (
    code text NOT NULL,
    name text NOT NULL,
    parent_code text,
    type text NOT NULL,
    is_summary boolean NOT NULL,
    formula text,
    sort_order integer NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO _village_dre_seed (code, name, parent_code, type, is_summary, formula, sort_order) VALUES
    -- 1. Receitas Diretas
    ('1',   'Receitas Diretas',                              NULL, 'receita',   true,  NULL,    1),
    ('1.1', 'Clientes - Serviços Prestados',                 '1',  'receita',   false, NULL,    1),
    ('1.2', 'Clientes - Receita com Serviços Vendidos',      '1',  'receita',   false, NULL,    2),

    -- 2. Receitas Indiretas
    ('2',   'Receitas Indiretas',                            NULL, 'receita',   true,  NULL,    2),
    ('2.1', 'Rendimentos de Aplicações',                     '2',  'receita',   false, NULL,    1),
    ('2.2', 'Outras Receitas',                               '2',  'receita',   false, NULL,    2),
    ('2.3', 'Reembolso de Despesas',                         '2',  'receita',   false, NULL,    3),

    -- 3. Deducoes da Receita
    ('3',   'Deduções da Receita',                           NULL, 'despesa',   true,  NULL,    3),
    ('3.1', 'ISS',                                           '3',  'despesa',   false, NULL,    1),
    ('3.2', 'COFINS',                                        '3',  'despesa',   false, NULL,    2),
    ('3.3', 'PIS',                                           '3',  'despesa',   false, NULL,    3),
    ('3.4', 'Retenções Federais',                            '3',  'despesa',   false, NULL,    4),
    ('3.5', 'Devoluções de Vendas',                          '3',  'despesa',   false, NULL,    5),

    -- 4. Receita Operacional Liquida
    ('4',   'Receita Operacional Líquida',                   NULL, 'calculado', true,  '1+2-3', 4),

    -- 5. Despesas Diretas
    ('5',   'Despesas Diretas',                              NULL, 'despesa',   true,  NULL,    5),
    ('5.1', 'Custos de Serviços e Produtos de Contratos Vendidos', '5', 'despesa', false, NULL, 1),

    -- 6. Lucro Operacional Bruto
    ('6',   'Lucro Operacional Bruto',                       NULL, 'calculado', true,  '4-5',   6),

    -- 7. Despesas Operacionais (sum dos subgrupos 7.1..7.4)
    ('7',   'Despesas Operacionais',                         NULL, 'despesa',   true,  NULL,    7),

    -- 7.1 Despesas Administrativas
    ('7.1',    'Despesas Administrativas',                              '7',   'despesa', true,  NULL, 1),
    ('7.1.1',  'Aluguel',                                               '7.1', 'despesa', false, NULL, 1),
    ('7.1.2',  'Condomínio',                                            '7.1', 'despesa', false, NULL, 2),
    ('7.1.3',  'Água e Esgoto',                                         '7.1', 'despesa', false, NULL, 3),
    ('7.1.4',  'Energia Elétrica',                                      '7.1', 'despesa', false, NULL, 4),
    ('7.1.5',  'Telefonia',                                             '7.1', 'despesa', false, NULL, 5),
    ('7.1.6',  'Manutenção de Imobilizado',                             '7.1', 'despesa', false, NULL, 6),
    ('7.1.7',  'Seguros',                                               '7.1', 'despesa', false, NULL, 7),
    ('7.1.8',  'IPTU',                                                  '7.1', 'despesa', false, NULL, 8),
    ('7.1.9',  'Contabilidade',                                         '7.1', 'despesa', false, NULL, 9),
    ('7.1.10', 'Advogados',                                             '7.1', 'despesa', false, NULL, 10),
    ('7.1.11', 'Segurança',                                             '7.1', 'despesa', false, NULL, 11),
    ('7.1.12', 'Outras Despesas Administrativas',                       '7.1', 'despesa', false, NULL, 12),
    ('7.1.13', 'Softwares, Sistemas e Servidores',                      '7.1', 'despesa', false, NULL, 13),
    ('7.1.14', 'Material Limpeza / Escritório / Mercado / Padaria',     '7.1', 'despesa', false, NULL, 14),
    ('7.1.15', 'Fretes e Transportes em Geral',                        '7.1', 'despesa', false, NULL, 15),
    ('7.1.16', 'Assessoria Administrativa',                             '7.1', 'despesa', false, NULL, 16),
    ('7.1.17', 'Taxas Diversas',                                        '7.1', 'despesa', false, NULL, 17),

    -- 7.2 Despesas com Pessoal
    ('7.2',    'Despesas com Pessoal',                                  '7',   'despesa', true,  NULL, 2),
    ('7.2.1',  'Salários',                                              '7.2', 'despesa', false, NULL, 1),
    ('7.2.2',  'Férias',                                                '7.2', 'despesa', false, NULL, 2),
    ('7.2.3',  'Rescisões',                                             '7.2', 'despesa', false, NULL, 3),
    ('7.2.4',  '13º Salário',                                           '7.2', 'despesa', false, NULL, 4),
    ('7.2.5',  'INSS',                                                  '7.2', 'despesa', false, NULL, 5),
    ('7.2.6',  'FGTS',                                                  '7.2', 'despesa', false, NULL, 6),
    ('7.2.7',  'IRRF Sobre Folha',                                      '7.2', 'despesa', false, NULL, 7),
    ('7.2.8',  'Pensão Alimentícia',                                    '7.2', 'despesa', false, NULL, 8),
    ('7.2.9',  'Assistência Médica',                                    '7.2', 'despesa', false, NULL, 9),
    ('7.2.10', 'Vale Transporte / Mobilidade',                         '7.2', 'despesa', false, NULL, 10),
    ('7.2.11', 'Benefícios Flexíveis',                                  '7.2', 'despesa', false, NULL, 11),
    ('7.2.12', 'Seguro de Vida',                                        '7.2', 'despesa', false, NULL, 12),
    ('7.2.13', 'Outros Benefícios',                                     '7.2', 'despesa', false, NULL, 13),
    ('7.2.14', 'Pró Labore Sócios',                                     '7.2', 'despesa', false, NULL, 14),
    ('7.2.15', 'Outros (Contribuição Sindical - PCMO, Exames...)',      '7.2', 'despesa', false, NULL, 15),
    ('7.2.16', 'Capacitação e Treinamentos',                           '7.2', 'despesa', false, NULL, 16),
    ('7.2.17', 'Endomarketing',                                        '7.2', 'despesa', false, NULL, 17),
    ('7.2.18', 'Salários PJ',                                          '7.2', 'despesa', false, NULL, 18),

    -- 7.3 Despesas de Vendas e Marketing
    ('7.3',   'Despesas de Vendas e Marketing',                        '7',   'despesa', true,  NULL, 3),
    ('7.3.1', 'Comissões',                                             '7.3', 'despesa', false, NULL, 1),
    ('7.3.2', 'Marketing',                                             '7.3', 'despesa', false, NULL, 2),
    ('7.3.3', 'Despesa de Captação de Clientes',                       '7.3', 'despesa', false, NULL, 3),
    ('7.3.4', 'Despesas de Viagens',                                   '7.3', 'despesa', false, NULL, 4),
    ('7.3.5', 'Bonificações',                                          '7.3', 'despesa', false, NULL, 5),

    -- 7.4 Despesas Financeiras / Bancos
    ('7.4',   'Despesas Financeiras / Bancos',                         '7',   'despesa', true,  NULL, 4),
    ('7.4.1', 'Juros sobre Empréstimos',                               '7.4', 'despesa', false, NULL, 1),
    ('7.4.2', 'Multas',                                                '7.4', 'despesa', false, NULL, 2),
    ('7.4.3', 'Tarifas Bancárias',                                     '7.4', 'despesa', false, NULL, 3),
    ('7.4.4', 'IOF s/ Aplicação Financeira',                           '7.4', 'despesa', false, NULL, 4),
    ('7.4.5', 'IR s/ Aplicação Financeira',                            '7.4', 'despesa', false, NULL, 5),

    -- 8. Resultado do Exercicio Antes IR e CS
    ('8',   'Resultado do Exercício Antes IR e CS',          NULL, 'calculado', true,  '6-7',    8),

    -- 9. IRPJ
    ('9',   'IRPJ',                                          NULL, 'despesa',   false, NULL,     9),

    -- 10. Contribuicao Social
    ('10',  'Contribuição Social',                           NULL, 'despesa',   false, NULL,     10),

    -- 11. Resultado Apos IR e CS (DRE_RESULTADO_EXERCICIO_CODE)
    ('11',  'Resultado Após IR e CS',                        NULL, 'calculado', true,  '8-9-10', 11);

  -- ============================================================================
  -- Insert: apos o cleanup, sem WHERE NOT EXISTS.
  -- O trigger `dre_accounts_set_level` recalcula `level` a partir do `code`.
  -- ============================================================================
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
  FROM _village_dre_seed s;

  -- ============================================================================
  -- Update: wire up parent_id por code (so dentro do escopo da Village).
  -- O trigger `dre_accounts_check_parent_scope` valida mesmo company_id.
  -- ============================================================================
  UPDATE public.dre_accounts c
  SET parent_id = p.id
  FROM _village_dre_seed s
  INNER JOIN public.dre_accounts p
    ON p.company_id = v_company_id AND p.code = s.parent_code
  WHERE c.company_id = v_company_id
    AND c.code = s.code
    AND s.parent_code IS NOT NULL;

  RAISE NOTICE 'Village reseed: % contas DRE inseridas com sucesso.',
    (SELECT count(*) FROM public.dre_accounts WHERE company_id = v_company_id);
END $$;
