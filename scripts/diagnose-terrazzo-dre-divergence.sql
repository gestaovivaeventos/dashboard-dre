-- =============================================================================
-- Diagnóstico: divergência DRE Terrazzo (dashboard vs One Page Report)
-- Período do relatório: 01/01/2026 a 30/06/2026
-- =============================================================================
-- SINTOMA
--   Dashboard "Resultado do Exercício" = -503.917,72
--   Relatório "Resultado"              = -482.754,00
--   Δ = 21.163,72, localizada INTEIRAMENTE em "Despesas Operacionais" (código 7).
--   Receita, Lucro Op. Bruto, IRPJ e CSLL batem ao centavo nos dois.
--
-- HIPÓTESE
--   A linha "Insumos de operação" (conta filha do código 7, marcada
--   data_source='sheets' na migration 20260618130000) carrega ~R$ 21.163,72 de
--   Omie RESIDUAL na tabela materializada `dre_monthly_aggregates`, OU as duas
--   RPCs deployadas leem fontes diferentes (drift). O dashboard soma o Omie
--   residual + a planilha; o relatório conta só a planilha.
--
-- COMO USAR
--   Rode seção por seção no SQL Editor do Supabase (ou psql). As seções 1–4 são
--   somente leitura (diagnóstico). A seção 5 é a CORREÇÃO — só rode depois de
--   confirmar o diagnóstico nas seções anteriores.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- SEÇÃO 0 — Identificação da empresa e da conta "Insumos de operação"
-- -----------------------------------------------------------------------------
SELECT id AS terrazzo_company_id, name, segment_id
FROM public.companies
WHERE name = 'Terrazzo';

-- Todas as contas 'sheets' da Terrazzo + a linha Insumos. Confirma data_source e
-- code de cada uma. Espera-se: 1.1, 1.2, 3.2, 3.3, 9, 10 e "Insumos de operação".
SELECT da.code, da.name, da.data_source
FROM public.dre_accounts da
JOIN public.companies c ON c.id = da.company_id
WHERE c.name = 'Terrazzo'
  AND (da.data_source = 'sheets' OR btrim(lower(da.name)) LIKE 'insumos de opera%')
ORDER BY da.data_source, da.code NULLS LAST, da.name;


-- -----------------------------------------------------------------------------
-- SEÇÃO 1 — SMOKING GUN: comparar as 3 RPCs por conta (Jan–Jun/2026)
-- -----------------------------------------------------------------------------
-- agg  = dashboard_dre_aggregate           (usada pelo RELATÓRIO — período)
-- mon  = dashboard_dre_aggregate_monthly   (usada pelo DASHBOARD — por mês, somado)
-- live = dashboard_dre_aggregate_live       (recálculo AO VIVO de referência)
-- Onde agg <> mon => as duas telas realmente divergem naquela conta.
-- Onde (agg ou mon) <> live => a materialização está stale para aquela conta.
WITH ids AS (
  SELECT ARRAY[(SELECT id FROM public.companies WHERE name = 'Terrazzo')]::uuid[] AS company_ids
),
agg AS (
  SELECT dre_account_id, amount
  FROM ids, public.dashboard_dre_aggregate(ids.company_ids, DATE '2026-01-01', DATE '2026-06-30')
),
mon AS (
  SELECT dre_account_id, sum(amount)::numeric AS amount
  FROM ids, public.dashboard_dre_aggregate_monthly(ids.company_ids, DATE '2026-01-01', DATE '2026-06-30')
  GROUP BY dre_account_id
),
live AS (
  SELECT dre_account_id, amount
  FROM ids, public.dashboard_dre_aggregate_live(ids.company_ids, DATE '2026-01-01', DATE '2026-06-30')
)
SELECT
  da.code,
  da.name,
  da.data_source,
  round(agg.amount,  2) AS relatorio_agg,
  round(mon.amount,  2) AS dashboard_mon,
  round(live.amount, 2) AS live_ref,
  round(COALESCE(mon.amount,0) - COALESCE(agg.amount,0), 2)  AS delta_dashboard_menos_relatorio,
  round(COALESCE(mon.amount,0) - COALESCE(live.amount,0), 2) AS delta_dashboard_menos_live
FROM agg
FULL JOIN mon  USING (dre_account_id)
FULL JOIN live USING (dre_account_id)
JOIN public.dre_accounts da ON da.id = COALESCE(agg.dre_account_id, mon.dre_account_id, live.dre_account_id)
WHERE round(COALESCE(mon.amount,0) - COALESCE(agg.amount,0), 2)  <> 0
   OR round(COALESCE(mon.amount,0) - COALESCE(live.amount,0), 2) <> 0
ORDER BY abs(COALESCE(mon.amount,0) - COALESCE(agg.amount,0)) DESC;
-- LEITURA:
--  • Linha "Insumos de operação" com delta_dashboard_menos_relatorio ≈ 21.163,72
--    => confirma que a divergência mora nessa conta (código 7).
--  • Se NENHUMA linha aparecer aqui, as RPCs concordam no banco AGORA => o
--    relatório-PDF foi gerado ANTES de um refresh (divergência de tempo, não de
--    dados atuais); regere o relatório.


-- -----------------------------------------------------------------------------
-- SEÇÃO 2 — Omie RESIDUAL na materialização para "Insumos de operação"
-- -----------------------------------------------------------------------------
-- A conta é 'sheets'; NÃO deveria haver linhas dela em dre_monthly_aggregates
-- (o refresh só insere data_source='omie'). Se aparecer algo aqui, é stale.
SELECT dma.year, dma.month, round(dma.amount, 2) AS omie_residual_materializado, dma.updated_at
FROM public.dre_monthly_aggregates dma
JOIN public.dre_accounts da ON da.id = dma.dre_account_id
JOIN public.companies c ON c.id = dma.company_id
WHERE c.name = 'Terrazzo'
  AND btrim(lower(da.name)) LIKE 'insumos de opera%'
  AND dma.year = 2026 AND dma.month BETWEEN 1 AND 6
ORDER BY dma.year, dma.month;

-- Total do Omie residual (deve ser ~21.163,72 se a hipótese estiver certa; ou 0
-- se a materialização já estiver limpa).
SELECT round(COALESCE(sum(dma.amount),0), 2) AS total_omie_residual_insumos_jan_jun_2026
FROM public.dre_monthly_aggregates dma
JOIN public.dre_accounts da ON da.id = dma.dre_account_id
JOIN public.companies c ON c.id = dma.company_id
WHERE c.name = 'Terrazzo'
  AND btrim(lower(da.name)) LIKE 'insumos de opera%'
  AND dma.year = 2026 AND dma.month BETWEEN 1 AND 6;


-- -----------------------------------------------------------------------------
-- SEÇÃO 3 — Valor da planilha (manual_account_values) para "Insumos de operação"
-- -----------------------------------------------------------------------------
SELECT mav.ano, mav.mes, round(mav.valor, 2) AS valor_planilha
FROM public.manual_account_values mav
JOIN public.dre_accounts da ON da.id = mav.dre_account_id
JOIN public.companies c ON c.id = mav.company_id
WHERE c.name = 'Terrazzo'
  AND btrim(lower(da.name)) LIKE 'insumos de opera%'
  AND mav.ano = 2026 AND mav.mes BETWEEN 1 AND 6
ORDER BY mav.ano, mav.mes;


-- -----------------------------------------------------------------------------
-- SEÇÃO 4 — Detecção de DRIFT: o que cada função DEPLOYADA realmente lê
-- -----------------------------------------------------------------------------
-- reads_materialized=true  => lê dre_monthly_aggregates (versão nova)
-- scans_live=true          => varre financial_entries (versão antiga ao vivo)
-- Se dashboard_dre_aggregate e _monthly diferirem nessas colunas, há drift de
-- deploy: as duas telas leem fontes diferentes.
SELECT
  p.proname,
  (pg_get_functiondef(p.oid) LIKE '%dre_monthly_aggregates%') AS reads_materialized,
  (pg_get_functiondef(p.oid) LIKE '%financial_entries%')      AS scans_live
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'dashboard_dre_aggregate',
    'dashboard_dre_aggregate_monthly',
    'dashboard_dre_aggregate_live',
    'refresh_dre_monthly_aggregates'
  )
ORDER BY p.proname;

-- (Opcional) Corpo completo das duas RPCs de leitura, para inspeção lado a lado:
-- SELECT pg_get_functiondef('public.dashboard_dre_aggregate(uuid[],date,date)'::regprocedure);
-- SELECT pg_get_functiondef('public.dashboard_dre_aggregate_monthly(uuid[],date,date)'::regprocedure);


-- =============================================================================
-- SEÇÃO 5 — CORREÇÃO (rodar só após confirmar o diagnóstico acima)
-- =============================================================================
-- Recalcula a materialização SÓ da Terrazzo. Como "Insumos de operação" é
-- data_source='sheets', o refresh remove qualquer Omie residual dela; o
-- dashboard passa a exibir só o valor da planilha, batendo com o relatório.
SELECT public.refresh_dre_monthly_aggregates(
  ARRAY[(SELECT id FROM public.companies WHERE name = 'Terrazzo')]::uuid[]
);

-- Re-verificação: após o refresh, a Seção 2 deve retornar 0 de Omie residual e a
-- Seção 1 não deve mais listar "Insumos de operação" com delta. Rode a Seção 1 de
-- novo e confirme que dashboard_mon == relatorio_agg para todas as contas.
-- =============================================================================
