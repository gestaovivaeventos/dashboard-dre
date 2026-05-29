-- =============================================================================
-- Feat Producoes (segmento Feat) — Plano DRE custom dedicado
-- =============================================================================
-- Cria a estrutura completa do DRE da Feat Producoes como plano per-company
-- a partir do zero (sem fork-on-edit do plano global), seguindo o mesmo padrao
-- da SGX. Mantem o plano global e os planos das demais empresas intactos.
--
-- Estrutura tirada da aba "DRE Feat" do workbook do gestor (1r2HEh5Q...). A
-- diferenca principal em relacao ao plano global eh que IRPJ e Contribuicao
-- Social ficam top-level (codes 9 e 10), "Resultado dos eventos" vira leaf
-- de Receitas Diretas (code 1.1), e "Lucro Liquido" (code 8) tem formula
-- 6-7 (sem subtrair IR/CS, que entram apos no code 11).
--
-- Hierarquia (codes 1..11 DRE + 20..24 fluxo de caixa):
--   1   Receitas Diretas                  [sum] (1.1..1.3)
--   2   Outras Entradas                   [sum] (2.1..2.5)
--   3   Deducoes de Receita               [sum] (3.1..3.4)
--   4   Receita Liquida                   [calculado: 1+2-3]
--   5   Despesas Diretas                  [sum] (5.1..5.3)
--   6   Lucro Operacional Bruto           [calculado: 4-5]
--   7   Despesas Operacionais             [sum] (7.1..7.5 + filhos)
--   8   Lucro Liquido                     [calculado: 6-7]
--   9   IRPJ                              [leaf]
--   10  Contribuicao Social               [leaf]
--   11  Resultado Apos IR e CS            [calculado: 8-9-10]
--   20  Emprestimos e Mutuos              [misto, sum] (20.1, 20.2)
--   21  Investimentos                     [sum] (21.1..21.5)
--   22  Dividendos                        [misto, sum] (22.1..22.3)
--   23  Aportes                           [sum] (23.1..23.2)
--   24  Fluxo de Caixa                    [calculado] (24.1..24.4)
--
-- Mapeamento Google Sheets → contas: code 1.1, 3.1, 3.2, 3.3, 9 e 10 vao
-- receber valores via planilha (configurado em migration separada).
--
-- Idempotente: pode ser re-aplicada sem efeito colateral. Cada conta eh
-- inserida apenas se nao existir (company_id, code) ainda.
-- =============================================================================

DO $$
DECLARE
  v_company_id uuid;
BEGIN
  SELECT id INTO v_company_id
  FROM public.companies
  WHERE name = 'Feat Producoes'
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RAISE NOTICE 'Company Feat Producoes nao encontrada — pulando seed do plano DRE.';
    RETURN;
  END IF;

  -- Temp table com toda a hierarquia. ON COMMIT DROP descarta ao final.
  CREATE TEMP TABLE _feat_dre_seed (
    code text NOT NULL,
    name text NOT NULL,
    parent_code text,
    type text NOT NULL,
    is_summary boolean NOT NULL,
    formula text,
    sort_order integer NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO _feat_dre_seed (code, name, parent_code, type, is_summary, formula, sort_order) VALUES
    -- 1. Receitas Diretas
    ('1',   'Receitas Diretas',                              NULL, 'receita',   true,  NULL,    1),
    ('1.1', 'Resultado dos eventos',                         '1',  'receita',   false, NULL,    1),
    ('1.2', 'Patrocínios',                                   '1',  'receita',   false, NULL,    2),
    ('1.3', 'Receitas Não Operacionais',                     '1',  'receita',   false, NULL,    3),

    -- 2. Outras Entradas
    ('2',   'Outras Entradas',                               NULL, 'receita',   true,  NULL,    2),
    ('2.1', 'Adiantamento de Clientes',                      '2',  'receita',   false, NULL,    1),
    ('2.2', 'Rendimentos de Aplicações',                     '2',  'receita',   false, NULL,    2),
    ('2.3', 'Receitas Ressarciveis',                         '2',  'receita',   false, NULL,    3),
    ('2.4', 'Reembolso de Despesas / Estorno de freelancer', '2',  'receita',   false, NULL,    4),
    ('2.5', 'Devoluções de Compra de Serviços',              '2',  'receita',   false, NULL,    5),

    -- 3. Deducoes de Receita
    ('3',   'Deduções de Receita',                                          NULL, 'despesa',   true,  NULL, 3),
    ('3.1', 'ISS',                                                          '3',  'despesa',   false, NULL, 1),
    ('3.2', 'PIS',                                                          '3',  'despesa',   false, NULL, 2),
    ('3.3', 'COFINS',                                                       '3',  'despesa',   false, NULL, 3),
    ('3.4', 'Devoluções de Locações e/ou Serviços Prestados',               '3',  'despesa',   false, NULL, 4),

    -- 4. Receita Liquida
    ('4',   'Receita Líquida',                               NULL, 'calculado', true,  '1+2-3', 4),

    -- 5. Despesas Diretas
    ('5',   'Despesas Diretas',                              NULL, 'despesa',   true,  NULL,    5),
    ('5.1', 'Compra de Serviços',                            '5',  'despesa',   false, NULL,    1),
    ('5.2', 'Mão de obra - Freelancer',                      '5',  'despesa',   false, NULL,    2),
    ('5.3', 'Participações de Sócios em Eventos',            '5',  'despesa',   false, NULL,    3),

    -- 6. Lucro Operacional Bruto
    ('6',   'Lucro Operacional Bruto',                       NULL, 'calculado', true,  '4-5',   6),

    -- 7. Despesas Operacionais (sum dos subgrupos 7.1..7.5)
    ('7',   'Despesas Operacionais',                         NULL, 'despesa',   true,  NULL,    7),

    -- 7.1 Despesas Administrativas
    ('7.1',    'Despesas Administrativas',                                                '7',   'despesa', true, NULL, 1),
    ('7.1.1',  'Aluguel',                                                                 '7.1', 'despesa', false, NULL, 1),
    ('7.1.2',  'Condomínio',                                                              '7.1', 'despesa', false, NULL, 2),
    ('7.1.3',  'Água e Esgoto',                                                           '7.1', 'despesa', false, NULL, 3),
    ('7.1.4',  'Energia Elétrica',                                                        '7.1', 'despesa', false, NULL, 4),
    ('7.1.5',  'Telefonia',                                                               '7.1', 'despesa', false, NULL, 5),
    ('7.1.6',  'Manutenção de Imobilizado',                                               '7.1', 'despesa', false, NULL, 6),
    ('7.1.7',  'Seguros',                                                                 '7.1', 'despesa', false, NULL, 7),
    ('7.1.8',  'IPTU',                                                                    '7.1', 'despesa', false, NULL, 8),
    ('7.1.9',  'Contabilidade',                                                           '7.1', 'despesa', false, NULL, 9),
    ('7.1.10', 'Advogados',                                                               '7.1', 'despesa', false, NULL, 10),
    ('7.1.11', 'Segurança',                                                               '7.1', 'despesa', false, NULL, 11),
    ('7.1.12', 'Taxas Diversas',                                                          '7.1', 'despesa', false, NULL, 12),
    ('7.1.13', 'Consultorias e Treinamentos',                                             '7.1', 'despesa', false, NULL, 13),
    ('7.1.14', 'Assessoria Administrativa',                                               '7.1', 'despesa', false, NULL, 14),
    ('7.1.15', 'Material Limpeza / Escritório / Mercado / Padaria',                       '7.1', 'despesa', false, NULL, 15),
    ('7.1.16', 'Outras Despesas Administrativas',                                         '7.1', 'despesa', false, NULL, 16),
    ('7.1.17', 'Softwares, Sistemas e Servidores',                                        '7.1', 'despesa', false, NULL, 17),
    ('7.1.18', 'Fretes e Transportes em Geral',                                           '7.1', 'despesa', false, NULL, 18),

    -- 7.2 Despesas com Pessoal
    ('7.2',    'Despesas com Pessoal',                                                    '7',   'despesa', true, NULL, 2),
    ('7.2.1',  'Salários',                                                                '7.2', 'despesa', false, NULL, 1),
    ('7.2.2',  'Férias',                                                                  '7.2', 'despesa', false, NULL, 2),
    ('7.2.3',  'Rescisões',                                                               '7.2', 'despesa', false, NULL, 3),
    ('7.2.4',  '13º Salário',                                                             '7.2', 'despesa', false, NULL, 4),
    ('7.2.5',  'INSS',                                                                    '7.2', 'despesa', false, NULL, 5),
    ('7.2.6',  'FGTS',                                                                    '7.2', 'despesa', false, NULL, 6),
    ('7.2.7',  'IRRF',                                                                    '7.2', 'despesa', false, NULL, 7),
    ('7.2.8',  'Pensão Alimentícia',                                                      '7.2', 'despesa', false, NULL, 8),
    ('7.2.9',  'Assistência Médica',                                                      '7.2', 'despesa', false, NULL, 9),
    ('7.2.10', 'Vale Transporte',                                                         '7.2', 'despesa', false, NULL, 10),
    ('7.2.11', 'Benefícios Flexíveis',                                                    '7.2', 'despesa', false, NULL, 11),
    ('7.2.12', 'Seguro de Vida',                                                          '7.2', 'despesa', false, NULL, 12),
    ('7.2.13', 'Outros Benefícios',                                                       '7.2', 'despesa', false, NULL, 13),
    ('7.2.14', 'Capacitação e Treinamentos',                                              '7.2', 'despesa', false, NULL, 14),
    ('7.2.15', 'Outros (Contribuição Sindical, PCMO, Exames)',                            '7.2', 'despesa', false, NULL, 15),
    ('7.2.16', 'Pró Labore - Sócios',                                                     '7.2', 'despesa', false, NULL, 16),
    ('7.2.17', 'Bônus EBITDA',                                                            '7.2', 'despesa', false, NULL, 17),
    ('7.2.18', 'Ações de Endomarketing',                                                  '7.2', 'despesa', false, NULL, 18),
    ('7.2.19', 'Contratos com pessoas jurídicas',                                         '7.2', 'despesa', false, NULL, 19),

    -- 7.3 Despesas de Vendas e Marketing
    ('7.3',    'Despesas de Vendas e Marketing',                                          '7',   'despesa', true, NULL, 3),
    ('7.3.1',  'Comissões Comercial',                                                     '7.3', 'despesa', false, NULL, 1),
    ('7.3.2',  'Marketing',                                                               '7.3', 'despesa', false, NULL, 2),
    ('7.3.3',  'Despesa de Captação de Clientes',                                         '7.3', 'despesa', false, NULL, 3),
    ('7.3.4',  'Patrocínio',                                                              '7.3', 'despesa', false, NULL, 4),

    -- 7.4 Despesas Financeiras / Bancos
    ('7.4',    'Despesas Financeiras / Bancos',                                           '7',   'despesa', true, NULL, 4),
    ('7.4.1',  'Juros sobre Empréstimos',                                                 '7.4', 'despesa', false, NULL, 1),
    ('7.4.2',  'Multas',                                                                  '7.4', 'despesa', false, NULL, 2),
    ('7.4.3',  'IOF',                                                                     '7.4', 'despesa', false, NULL, 3),
    ('7.4.4',  'IOF s/ Aplicação Financeira',                                             '7.4', 'despesa', false, NULL, 4),
    ('7.4.5',  'IR s/ Aplicação Financeira',                                              '7.4', 'despesa', false, NULL, 5),
    ('7.4.6',  'Tarifas Bancárias',                                                       '7.4', 'despesa', false, NULL, 6),

    -- 7.5 Outras Despesas
    ('7.5',    'Outras Despesas',                                                         '7',   'despesa', true, NULL, 5),
    ('7.5.1',  'Despesas Ressarcíveis',                                                   '7.5', 'despesa', false, NULL, 1),
    ('7.5.2',  'IRRF Sobre Nota Fiscal',                                                  '7.5', 'despesa', false, NULL, 2),
    ('7.5.3',  'Doação',                                                                  '7.5', 'despesa', false, NULL, 3),

    -- 8. Lucro Liquido (formula 6-7; diferente do plano global que vai ate IRPJ/CSLL)
    ('8',   'Lucro Líquido',                                  NULL, 'calculado', true,  '6-7',   8),

    -- 9. IRPJ (top-level no plano da Feat)
    ('9',   'IRPJ',                                           NULL, 'despesa',   false, NULL,    9),

    -- 10. Contribuicao Social (top-level no plano da Feat)
    ('10',  'Contribuição Social',                            NULL, 'despesa',   false, NULL,    10),

    -- 11. Resultado Apos IR e CS (DRE_RESULTADO_EXERCICIO_CODE compat)
    ('11',  'Resultado Após IR e CS',                         NULL, 'calculado', true,  '8-9-10', 11),

    -- ===== Fluxo de Caixa (codes 20..24) =====

    -- 20. Emprestimos e Mutuos (misto: tem entradas e saidas)
    ('20',   'Empréstimos e Mútuos',                          NULL, 'misto',     true,  NULL,    20),
    ('20.1', 'Entradas (Empréstimos / Mútuos)',               '20', 'receita',   false, NULL,    1),
    ('20.2', 'Saídas (Empréstimos / Mútuos)',                 '20', 'despesa',   false, NULL,    2),

    -- 21. Investimentos
    ('21',   'Investimentos',                                 NULL, 'despesa',   true,  NULL,    21),
    ('21.1', 'Máquinas e Equipamentos',                       '21', 'despesa',   false, NULL,    1),
    ('21.2', 'Instalações',                                   '21', 'despesa',   false, NULL,    2),
    ('21.3', 'Equipamentos de Informática',                   '21', 'despesa',   false, NULL,    3),
    ('21.4', 'Móveis e Utensílios',                           '21', 'despesa',   false, NULL,    4),
    ('21.5', 'Compra de Ativos',                              '21', 'despesa',   false, NULL,    5),

    -- 22. Dividendos (misto: recebidos sao entrada, pagamentos sao saida)
    ('22',   'Dividendos',                                    NULL, 'misto',     true,  NULL,    22),
    ('22.1', 'Dividendos Recebidos',                          '22', 'receita',   false, NULL,    1),
    ('22.2', 'Fernando Sotrate',                              '22', 'despesa',   false, NULL,    2),
    ('22.3', 'ABD Holding',                                   '22', 'despesa',   false, NULL,    3),

    -- 23. Aportes
    ('23',   'Aportes',                                       NULL, 'receita',   true,  NULL,    23),
    ('23.1', 'Fernando Sotrate (Aporte)',                     '23', 'receita',   false, NULL,    1),
    ('23.2', 'ABD Holding (Aporte)',                          '23', 'receita',   false, NULL,    2),

    -- 24. Fluxo de Caixa (consolidacao)
    ('24',   'Fluxo de Caixa',                                NULL, 'calculado', true,  '24.1+24.2-24.3', 24),
    ('24.1', 'Saldo Inicial',                                 '24', 'misto',     false, NULL,    1),
    ('24.2', 'Entradas',                                      '24', 'calculado', true,  '1+2+20.1+22.1+23', 2),
    ('24.3', 'Saídas',                                        '24', 'calculado', true,  '3+5+7+9+10+20.2+21+22.2+22.3', 3),
    ('24.4', 'Saldo Final',                                   '24', 'calculado', true,  '24.1+24.2-24.3', 4);

  -- ============================================================================
  -- Insert: apenas linhas que ainda nao existem (idempotente).
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
  FROM _feat_dre_seed s
  WHERE NOT EXISTS (
    SELECT 1 FROM public.dre_accounts d
    WHERE d.company_id = v_company_id AND d.code = s.code
  );

  -- ============================================================================
  -- Update: wire up parent_id por code (so dentro do escopo da Feat Producoes).
  -- O trigger `dre_accounts_check_parent_scope` valida que pai e filho tem o
  -- mesmo company_id — todos rows aqui sao da Feat, entao passa.
  -- ============================================================================
  UPDATE public.dre_accounts c
  SET parent_id = p.id
  FROM _feat_dre_seed s
  INNER JOIN public.dre_accounts p
    ON p.company_id = v_company_id AND p.code = s.parent_code
  WHERE c.company_id = v_company_id
    AND c.code = s.code
    AND s.parent_code IS NOT NULL
    AND (c.parent_id IS DISTINCT FROM p.id);
END $$;
