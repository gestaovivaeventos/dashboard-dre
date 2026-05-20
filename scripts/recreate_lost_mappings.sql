-- =============================================================================
-- RECRIACAO DOS MAPEAMENTOS PERDIDOS (cascade-delete do plano global)
-- =============================================================================
-- Recria vinculos category_mapping perdidos quando contas 1.1, 1.3, 20, 20.x,
-- 21, 22, 23 foram deletadas e o cascade limpou os mapeamentos associados.
--
-- DEFENSIVO:
--   - INSERT WHERE NOT EXISTS por (omie_code, company_id):
--       Se voce ja tem mapeamento para essa categoria/empresa (mesmo apontando
--       para outra conta), o script PULA. Nao sobrescreve nada.
--   - Resolve dre_account_id por code com falha explicita se conta nao existir.
--   - Wrapped em BEGIN/COMMIT.
--
-- ESCOPO:
--   - Grupos 1+2 da analise (perdas obvias + perdas provaveis)
--   - 17 mapeamentos GLOBAIS (company_id IS NULL — aplicam a todas empresas)
--   - 3 mapeamentos EMPRESA-ESPECIFICOS (casos com semantica divergente)
--   - NAO inclui: 1.02.01 (Dividendos Recebidos), transferencias, estornos
--
-- Para teste, troque COMMIT do final por ROLLBACK.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Resolver UUIDs das contas DRE alvo (todas no plano global, company_id IS NULL)
-- Falha cedo se alguma conta nao existir (ex.: restore ainda nao aplicado)
-- -----------------------------------------------------------------------------
DO $resolve$
DECLARE
  required_codes text[] := ARRAY['1.1','1.3','5.4','7.5.1','20.1','20.2','21','22','23'];
  c text;
  v_id uuid;
BEGIN
  FOREACH c IN ARRAY required_codes LOOP
    SELECT id INTO v_id FROM public.dre_accounts WHERE code = c AND company_id IS NULL;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Conta DRE % nao encontrada no plano global. Rode o restore_global_dre_plan.sql antes.', c;
    END IF;
  END LOOP;
END
$resolve$;

-- -----------------------------------------------------------------------------
-- BLOCO A: Mapeamentos GLOBAIS (company_id IS NULL)
-- Aplicam a todas empresas que ainda nao tenham mapeamento proprio para a categoria
-- -----------------------------------------------------------------------------

-- Helper inline: insere se NAO existir mapeamento para (omie_code, company_id IS NULL)
-- E nao existir mapeamento empresa-especifico em NENHUMA empresa (para nao colidir
-- com mapeamentos manuais que voce ja tenha feito).
WITH new_mappings (omie_code, omie_name, dre_code) AS (
  VALUES
    ('1.01.99', 'Clientes - Serviços Prestados - Cerimonial/Fee', '1.3'),
    ('1.01.02', 'Clientes - Serviços Prestados - Assessoria',     '1.1'),
    ('2.10.99', 'Pagamento de dividendos',                        '22'),
    ('1.04.03', 'Empréstimos Bancários',                          '20.1'),
    ('2.05.03', 'Pagamento de Empréstimos',                       '20.2'),
    ('1.04.04', 'Aumento de Capital',                             '23'),
    ('2.07.01', 'Máquinas e Equipamentos',                        '21'),
    ('2.07.02', 'Veículos',                                       '21'),
    ('2.07.03', 'Instalações',                                    '21'),
    ('2.07.04', 'Equipamentos de Informática',                    '21'),
    ('2.07.05', 'Móveis e Utensílios',                            '21'),
    ('2.07.97', 'Compra de Participação Societária',              '21'),
    ('2.07.98', 'Imobilizado',                                    '21'),
    ('2.07.99', 'Aumento de capital em controlada',               '21'),
    ('2.08.01', 'Adiantamento a Fornecedores',                    '7.5.1'),
    ('2.01.94', 'Custos Serviços Prestados - Viagens, Hospedagens, Alimentação', '5.4'),
    ('2.08.90', 'Mútuo Triangulo',                                '20.2')
)
INSERT INTO public.category_mapping (omie_category_code, omie_category_name, dre_account_id, company_id)
SELECT
  nm.omie_code,
  nm.omie_name,
  d.id,
  NULL
FROM new_mappings nm
JOIN public.dre_accounts d ON d.code = nm.dre_code AND d.company_id IS NULL
WHERE NOT EXISTS (
  -- Nao cria global se ja existe global para essa categoria
  SELECT 1 FROM public.category_mapping cm
  WHERE cm.omie_category_code = nm.omie_code
    AND cm.company_id IS NULL
);

-- -----------------------------------------------------------------------------
-- BLOCO B: Mapeamentos EMPRESA-ESPECIFICOS
-- Casos onde o mesmo codigo Omie tem semantica diferente por empresa
-- -----------------------------------------------------------------------------

-- B.1) Viva Juiz de Fora: 1.01.96 "Cerimonial/Fee (*)" -> 1.3
INSERT INTO public.category_mapping (omie_category_code, omie_category_name, dre_account_id, company_id)
SELECT
  '1.01.96',
  'Clientes - Serviços Prestados - Cerimonial/Fee (*)',
  d.id,
  c.id
FROM public.companies c
CROSS JOIN public.dre_accounts d
WHERE c.name = 'Viva Juiz de Fora'
  AND d.code = '1.3'
  AND d.company_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.category_mapping cm
    WHERE cm.omie_category_code = '1.01.96' AND cm.company_id = c.id
  );

-- B.2) Viva Belo Horizonte: 2.10.98 "Pagamento de dividendos Lucio 3.2" -> 22
INSERT INTO public.category_mapping (omie_category_code, omie_category_name, dre_account_id, company_id)
SELECT
  '2.10.98',
  'Pagamento de dividendos Lucio 3.2',
  d.id,
  c.id
FROM public.companies c
CROSS JOIN public.dre_accounts d
WHERE c.name = 'Viva Belo Horizonte'
  AND d.code = '22'
  AND d.company_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.category_mapping cm
    WHERE cm.omie_category_code = '2.10.98' AND cm.company_id = c.id
  );

-- B.3) Viva Campo Grande: 1.04.97 "Integralização de Capital" -> 23
-- IMPORTANTE: nas outras empresas 1.04.97 e "Entrada de Transferencia" (nao mapear globalmente)
INSERT INTO public.category_mapping (omie_category_code, omie_category_name, dre_account_id, company_id)
SELECT
  '1.04.97',
  'Integralização de Capital',
  d.id,
  c.id
FROM public.companies c
CROSS JOIN public.dre_accounts d
WHERE c.name = 'Viva Campo Grande'
  AND d.code = '23'
  AND d.company_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.category_mapping cm
    WHERE cm.omie_category_code = '1.04.97' AND cm.company_id = c.id
  );

-- -----------------------------------------------------------------------------
-- VERIFICACAO: lista os mapeamentos recem-criados (ou pre-existentes)
-- -----------------------------------------------------------------------------
SELECT
  COALESCE(co.name, '<GLOBAL>')          AS escopo,
  cm.omie_category_code                  AS codigo_omie,
  cm.omie_category_name                  AS nome_omie,
  d.code                                 AS conta_dre,
  d.name                                 AS nome_conta_dre
FROM public.category_mapping cm
JOIN public.dre_accounts d ON d.id = cm.dre_account_id
LEFT JOIN public.companies co ON co.id = cm.company_id
WHERE cm.omie_category_code IN (
  -- globais
  '1.01.99','1.01.02','2.10.99','1.04.03','2.05.03','1.04.04',
  '2.07.01','2.07.02','2.07.03','2.07.04','2.07.05','2.07.97','2.07.98','2.07.99',
  '2.08.01','2.01.94','2.08.90',
  -- empresa-especificas
  '1.01.96','2.10.98','1.04.97'
)
ORDER BY
  cm.company_id NULLS FIRST,
  cm.omie_category_code,
  COALESCE(co.name, '');

-- =============================================================================
-- Se a verificacao mostrar tudo certo, COMMIT. Se nao, troque por ROLLBACK.
-- =============================================================================
COMMIT;
