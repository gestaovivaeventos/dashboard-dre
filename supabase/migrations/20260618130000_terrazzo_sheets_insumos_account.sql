-- =============================================================================
-- Terrazzo — Linha "Insumos de operação" alimentada pela planilha Google Sheets
-- =============================================================================
-- Contexto:
--   Adiciona MAIS UMA linha da planilha sincronizada da Terrazzo ao dashboard
--   DRE, seguindo o mesmo padrao ja validado da migration
--   20260609120000_terrazzo_sheets_accounts (que marcou 6 contas como
--   data_source='sheets'):
--
--     Linha 14 da planilha ("Insumos")  ->  conta "Insumos de operação"
--
--   O sync (src/lib/sheets/terrazzo-sync.ts) le a linha 14 das abas 2025/2026 e
--   faz upsert dos valores mensais em `manual_account_values`. Para o dashboard
--   LER esses valores de `manual_account_values` (e nao do Omie), a conta-alvo
--   precisa estar marcada com `dre_accounts.data_source = 'sheets'` — e isto que
--   esta migration faz.
--
-- Por que por NOME (e nao por code):
--   O plano DRE da Terrazzo e custom e o code da conta "Insumos de operação" nao
--   e fixo/conhecido. O gestor definiu o destino pelo NOME. O match e escopado a
--   Terrazzo e usa um prefixo normalizado ('insumos de opera%') que tolera
--   variacoes de caixa/acentuacao ("operação"/"operacao") sem pegar outra linha.
--
-- O que esta migration FAZ (minimo e isolado):
--   • Marca SOMENTE a conta "Insumos de operação" da Terrazzo como
--     data_source = 'sheets' (escopo company_id = <Terrazzo>). Idempotente.
--   • Recalcula a materializacao (dre_monthly_aggregates) APENAS da Terrazzo.
--
-- O que esta migration NAO faz / NAO altera:
--   • NAO cria nem altera a estrutura/plano DRE da Terrazzo (so marca a fonte de
--     uma conta que ja deve existir).
--   • NAO altera as 6 contas ja marcadas em 20260609120000, nem o flag
--     dre_sum_sheets_with_omie (a Terrazzo continua exibindo SO a planilha).
--   • NAO altera a Feat, a Omie, o mapeamento de categorias, nem outra empresa.
-- =============================================================================

DO $$
DECLARE
  v_company_id uuid;
  v_marked integer;
BEGIN
  SELECT id INTO v_company_id
  FROM public.companies
  WHERE name = 'Terrazzo'
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RAISE NOTICE 'Company Terrazzo nao encontrada — pulando marcacao da conta Insumos.';
    RETURN;
  END IF;

  -- Marca a conta "Insumos de operação" da Terrazzo como sheets-sourced. Escopo
  -- estrito por company_id => nenhuma outra empresa e afetada. Match por prefixo
  -- normalizado, especifico o bastante dentro do plano da Terrazzo. Se a conta
  -- ainda nao existir, marca 0 linhas — o sync acusa com erro explicito.
  UPDATE public.dre_accounts
  SET data_source = 'sheets'
  WHERE company_id = v_company_id
    AND btrim(lower(name)) LIKE 'insumos de opera%'
    AND data_source <> 'sheets';

  GET DIAGNOSTICS v_marked = ROW_COUNT;
  RAISE NOTICE 'Terrazzo: % conta(s) "Insumos de operacao" marcada(s) como data_source=sheets.', v_marked;

  -- Recalcula a materializacao SO da Terrazzo (mesma logica de 20260609120000).
  PERFORM public.refresh_dre_monthly_aggregates(ARRAY[v_company_id]);
END $$;
