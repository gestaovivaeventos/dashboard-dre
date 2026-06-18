-- =============================================================================
-- Sirena — Linha "Locação de Espaço" alimentada pela planilha Google Sheets
-- =============================================================================
-- Contexto:
--   A Sirena passa a ter a linha "Locação de Espaço" do dashboard DRE alimentada
--   por uma planilha Google Sheets própria (mesmo padrão da Terrazzo, porém com
--   planilha/aba/linha/conta PROPRIAS da Sirena). O sync
--   (src/lib/sheets/sirena-sync.ts) lê a aba "2026", linha 11 ("total"), e faz
--   upsert dos valores mensais em `manual_account_values`. Para o dashboard LER
--   esses valores de `manual_account_values` (e não da Omie), a conta-alvo
--   precisa estar marcada com `dre_accounts.data_source = 'sheets'` — é o que
--   esta migration faz.
--
--   Mapeamento: Linha 11 da planilha ("total")  ->  conta "Locação de Espaço".
--
-- Diferente da Terrazzo, a Sirena NÃO traz impostos pela planilha — ISS, PIS,
-- COFINS, IRPJ e Contribuição Social são CALCULADOS pelo sistema no dashboard
-- (src/lib/dashboard/sirena-taxes.ts) a partir de "Receita de Estacionamento"
-- (Omie) + "Locação de Espaço" (planilha). Por isso esta migration marca SÓ a
-- conta de Locação — as linhas de imposto NÃO mudam de fonte (o cálculo é
-- aplicado na leitura do dashboard, sem alterar estrutura/mapeamento).
--
-- O que esta migration FAZ (mínimo e isolado):
--   • Marca SOMENTE a conta "Locação de Espaço" da Sirena como
--     data_source = 'sheets' (escopo company_id = <Sirena>). Idempotente.
--   • Recalcula a materialização (dre_monthly_aggregates) APENAS da Sirena.
--
-- O que esta migration NÃO faz / NÃO altera:
--   • NÃO cria nem altera a estrutura/plano DRE da Sirena (só marca a fonte de
--     uma conta que já deve existir).
--   • NÃO toca Terrazzo, Feat, Omie, mapeamento de categorias, nem outra empresa.
--   • NÃO altera a "Receita de Estacionamento" (continua vindo da Omie por
--     regime de caixa).
-- =============================================================================

DO $$
DECLARE
  v_company_id uuid;
  v_marked integer;
BEGIN
  SELECT id INTO v_company_id
  FROM public.companies
  WHERE name = 'Sirena'
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RAISE NOTICE 'Company Sirena nao encontrada — pulando marcacao da conta Locacao de Espaco.';
    RETURN;
  END IF;

  -- Marca a conta "Locação de Espaço" da Sirena como sheets-sourced. Escopo
  -- estrito por company_id => nenhuma outra empresa é afetada. Match por nome
  -- normalizado (case/acentos tolerados). Se a conta ainda não existir, marca 0
  -- linhas — o sync acusa com erro explícito.
  UPDATE public.dre_accounts
  SET data_source = 'sheets'
  WHERE company_id = v_company_id
    AND btrim(lower(name)) IN ('locação de espaço', 'locacao de espaco')
    AND data_source <> 'sheets';

  GET DIAGNOSTICS v_marked = ROW_COUNT;
  RAISE NOTICE 'Sirena: % conta(s) "Locacao de Espaco" marcada(s) como data_source=sheets.', v_marked;

  -- Recalcula a materialização SÓ da Sirena (mesma lógica das migrations da Terrazzo).
  PERFORM public.refresh_dre_monthly_aggregates(ARRAY[v_company_id]);
END $$;
