-- =============================================================================
-- Terrazzo — Linhas do DRE alimentadas por planilha Google Sheets
-- =============================================================================
-- Contexto:
--   A Terrazzo passa a ter algumas linhas do dashboard DRE alimentadas por uma
--   planilha do Google Sheets (igual ao padrao ja validado da Feat Producoes,
--   porem com planilha, abas, linhas e contas PROPRIAS da Terrazzo). O sync
--   (src/lib/sheets/terrazzo-sync.ts) le a planilha e faz upsert dos valores
--   mensais em `manual_account_values`. Para o dashboard LER esses valores de
--   `manual_account_values` (e nao do Omie), as contas-alvo precisam estar
--   marcadas com `dre_accounts.data_source = 'sheets'`.
--
--   Mapeamento planilha -> conta DRE da Terrazzo (resolvido por `code` dentro
--   do plano custom da Terrazzo):
--     Linha 12 da planilha  ->  1.1  Locacao de Espaco para Formaturas
--     Linha 13 da planilha  ->  1.2  Locacao de Espaco para Shows/Palestras
--     Linha 16 da planilha  ->  3.2  PIS
--     Linha 17 da planilha  ->  3.3  COFINS
--     Linha 18 da planilha  ->  9    IRPJ
--     Linha 19 da planilha  ->  10   Contribuicao Social
--
-- O que esta migration FAZ (minimo e isolado):
--   • Marca EXATAMENTE essas 6 contas da Terrazzo como data_source = 'sheets',
--     com escopo `company_id = <Terrazzo>` — nunca toca contas de outra empresa
--     nem o plano global. Idempotente.
--   • Recalcula a materializacao (dre_monthly_aggregates) APENAS da Terrazzo,
--     para que eventuais lancamentos da Omie que estivessem mapeados nessas 6
--     contas saiam do dashboard (essas linhas passam a vir SO da planilha).
--
-- O que esta migration NAO faz / NAO altera:
--   • NAO cria nem altera a estrutura/plano DRE da Terrazzo (apenas marca a
--     fonte de 6 contas que ja devem existir; se nao existirem, nada acontece e
--     o sync acusa o erro com mensagem clara).
--   • NAO liga o flag `dre_sum_sheets_with_omie` — diferente da Feat, a Terrazzo
--     NAO soma Omie nessas linhas; elas exibem somente o valor da planilha.
--   • NAO altera a Feat Producoes, a Omie, o mapeamento de categorias, nem
--     qualquer outra empresa. A coluna `data_source` default 'omie' preserva o
--     comportamento de todas as demais contas/empresas.
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
    RAISE NOTICE 'Company Terrazzo nao encontrada — pulando marcacao de contas sheets.';
    RETURN;
  END IF;

  -- Marca as 6 contas-alvo da Terrazzo como sheets-sourced. Escopo estrito por
  -- company_id => nenhuma outra empresa e afetada. Se algum code ainda nao
  -- existir no plano da Terrazzo, simplesmente nao marca (0 linhas) — o sync
  -- acusara a conta faltante com erro explicito.
  UPDATE public.dre_accounts
  SET data_source = 'sheets'
  WHERE company_id = v_company_id
    AND code IN ('1.1', '1.2', '3.2', '3.3', '9', '10')
    AND data_source <> 'sheets';

  GET DIAGNOSTICS v_marked = ROW_COUNT;
  RAISE NOTICE 'Terrazzo: % conta(s) marcada(s) como data_source=sheets.', v_marked;

  -- Recalcula a materializacao SO da Terrazzo. Como as contas acima agora sao
  -- 'sheets' e o flag dre_sum_sheets_with_omie esta desligado para a Terrazzo,
  -- o refresh deixa de materializar qualquer Omie dessas contas — o dashboard
  -- passa a refletir exclusivamente o valor da planilha (somado em
  -- manual_account_values pela RPC de leitura). Nao toca em outras empresas.
  PERFORM public.refresh_dre_monthly_aggregates(ARRAY[v_company_id]);
END $$;
