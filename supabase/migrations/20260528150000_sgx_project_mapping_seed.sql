-- =============================================================================
-- SGX (Real Estate) — Seed dos mapeamentos de projeto
-- =============================================================================
-- Cadastra os 14 projetos atuais da SGX no Omie em public.project_mapping,
-- vinculando cada projeto a uma conta DRE de receita e uma de despesa.
--
-- Many-to-one e suportado: 3 projetos (FABRICA DERMA CLEAN, SALA COMERCIAL
-- BAIRRO CASABLACA e VIVA FRANQUEADORA) mapeiam para PREDIO SAO PEDRO
-- (1.3 / 2.3) — sao inquilinos diferentes do mesmo predio.
--
-- Idempotente: ON CONFLICT (company_id, omie_project_code) DO UPDATE
-- atualiza nome e contas em re-execucoes; nao duplica linhas.
--
-- Escopado a empresa SGX. Nao toca em project_mapping de outras empresas
-- (hoje sao todas vazias). Se SGX nao existir em `companies`, pula sem erro.
-- =============================================================================

DO $$
DECLARE
  v_company_id uuid;
  v_total integer;
BEGIN
  SELECT id INTO v_company_id
  FROM public.companies
  WHERE name = 'SGX'
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RAISE NOTICE 'Company SGX nao encontrada — pulando seed de project_mapping.';
    RETURN;
  END IF;

  CREATE TEMP TABLE _sgx_proj_seed (
    omie_project_code text NOT NULL,
    omie_project_name text NOT NULL,
    revenue_code text NOT NULL,
    expense_code text NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO _sgx_proj_seed (omie_project_code, omie_project_name, revenue_code, expense_code) VALUES
    ('8407741897', 'BR 040',                                  '12.1', '13.1'),
    ('8407741919', 'CASA SANTA LUZIA - TORREOES 196',         '1.4',  '2.4'),
    ('8407742145', 'EMPREENDIMENTO GRAMINHA',                 '12.2', '13.2'),
    ('8407742158', 'EMPREENDIMENTO MARABO',                   '12.3', '13.3'),
    ('8407742318', 'EMPREENDIMENTO MIRANTE PARQUE GUARANI',   '12.4', '13.4'),
    ('8407743055', 'EMPREENDIMENTO RML',                      '12.5', '13.5'),
    ('8407743531', 'FABRICA DERMA CLEAN',                     '1.3',  '2.3'),
    ('8407744599', 'JARDIM DAS ACACIAS',                      '12.9', '13.9'),
    ('8407745470', 'LOTEAMENTO BARBACENA',                    '12.6', '13.6'),
    ('8407746195', 'SALA COMERCIAL BAIRRO CASABLACA',         '1.3',  '2.3'),
    ('8407746307', 'TERRAZZO',                                '1.1',  '2.1'),
    ('8407746440', 'VIVA FRANQUEADORA',                       '1.3',  '2.3'),
    ('8407746564', 'WALERY',                                  '12.8', '13.8'),
    ('8595668788', 'TAMISA BOM PASTOR',                       '12.7', '13.7');

  -- Resolve cada code (texto, ex.: '12.1') para o uuid da conta DRE no
  -- escopo da SGX. Se um code nao existir, a linha e pulada (LEFT JOIN +
  -- WHERE com OR).
  --
  -- ON CONFLICT garante idempotencia: re-aplicar a migration atualiza
  -- nome e contas em vez de duplicar (a tabela tem UNIQUE em
  -- (company_id, omie_project_code) via project_mapping_company_code_idx).
  INSERT INTO public.project_mapping (
    company_id,
    omie_project_code,
    omie_project_name,
    dre_account_revenue_id,
    dre_account_expense_id
  )
  SELECT
    v_company_id,
    s.omie_project_code,
    s.omie_project_name,
    rev.id,
    exp.id
  FROM _sgx_proj_seed s
  LEFT JOIN public.dre_accounts rev
    ON rev.company_id = v_company_id
   AND rev.code = s.revenue_code
   AND rev.active
  LEFT JOIN public.dre_accounts exp
    ON exp.company_id = v_company_id
   AND exp.code = s.expense_code
   AND exp.active
  -- O CHECK constraint project_mapping_has_destination exige pelo menos
  -- um destino. Skippa linhas onde ambos os codes nao foram resolvidos.
  WHERE rev.id IS NOT NULL OR exp.id IS NOT NULL
  ON CONFLICT (company_id, omie_project_code) DO UPDATE
  SET
    omie_project_name = EXCLUDED.omie_project_name,
    dre_account_revenue_id = EXCLUDED.dre_account_revenue_id,
    dre_account_expense_id = EXCLUDED.dre_account_expense_id,
    updated_at = now();

  SELECT count(*) INTO v_total
  FROM public.project_mapping
  WHERE company_id = v_company_id;

  RAISE NOTICE 'SGX project_mapping seed: % linhas totais apos seed.', v_total;
END $$;
