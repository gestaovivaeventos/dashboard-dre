-- =============================================================================
-- Eleva o statement_timeout das funcoes de refresh dos agregados materializados
-- =============================================================================
-- PROBLEMA
-- dashboard_dre_aggregate / cash_flow_aggregate leem das tabelas materializadas
-- dre_monthly_aggregates / cash_flow_monthly_aggregates. Essas tabelas sao
-- recalculadas por refresh_dre_monthly_aggregates / refresh_cash_flow_monthly_
-- aggregates, disparadas BEST-EFFORT ao salvar mapeamento (ver
-- src/lib/dashboard/aggregate-refresh.ts) e ao fim do sync.
--
-- Para empresas com muito historico (ex.: Feat Producoes, ~18 mil lancamentos),
-- o recalculo roda perto do statement_timeout padrao da role (~8s). Sob carga
-- ele estoura (SQLSTATE 57014) e, por ser best-effort, falha em silencio — o
-- salvamento do mapeamento conclui, mas o agregado materializado NAO atualiza.
-- Sintoma: uma conta recem-mapeada aparece no drilldown (que le AO VIVO) mas
-- some/zera na celula do dashboard (que le o materializado defasado), ate o
-- proximo refresh bem-sucedido (ex.: o sync diario).
--
-- CORRECAO
-- Define um statement_timeout generoso no escopo DESTAS funcoes (nao afeta
-- nenhuma outra query). Assim o recalculo conclui mesmo sob carga e o agregado
-- fica consistente com o drilldown logo apos a mudanca de mapeamento.
--
-- NAO altera nenhuma logica de calculo, mapeamento, rateio, roteamento de
-- departamento, projeto ou categoria — apenas o limite de tempo de execucao.
-- =============================================================================

ALTER FUNCTION public.refresh_dre_monthly_aggregates(uuid[])
  SET statement_timeout = '180s';

ALTER FUNCTION public.refresh_cash_flow_monthly_aggregates(uuid[])
  SET statement_timeout = '180s';
