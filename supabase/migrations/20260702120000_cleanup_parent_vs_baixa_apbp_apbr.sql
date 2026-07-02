-- =============================================================================
-- Fix: cleanup_parent_vs_baixa_duplicates passa a reconhecer baixas com
-- cOrigem APBP/APBR e, de forma robusta, QUALQUER movimento com nCodMovCC.
--
-- Contexto:
-- A versao anterior (20260519120000_cleanup_parent_vs_baixa_use_corigem)
-- so reconhecia baixas por cOrigem IN ('BAXR','BAXP'). Empresas cujas baixas
-- vem com outro cOrigem — observado APBP (a pagar) na Arte Vista e APBR
-- (a receber) na Feat Producoes, ambos COM nCodMovCC — nao eram detectadas.
-- Consequencia: o registro-pai (MANP/MANR/RPTP/APIR/EXTP/...) do MESMO
-- titulo permanecia no banco ao lado da baixa, dobrando o valor no DRE.
--
-- Sintoma observado (Arte Vista):
--   Titulo 9824690456 (GABBER, R$ 7.900,01, 15/01/2026, cat 2.01.04)
--   ficava com 2 entries — a view MANP (mov:9824690456:001/001:MANP, SEM
--   nCodMovCC) e a baixa APBP (mov:cc:9825924648, COM nCodMovCC). Como a
--   deteccao de baixa exigia cOrigem BAXR/BAXP, o titulo nao entrava em
--   titulos_com_baixa e a view-pai nunca era suprimida. 5 titulos assim
--   inflavam a categoria 2.01.04 em R$ 36.184,99. Mesmo padrao na Feat
--   (13 titulos APIR+APBR, cat 1.01.03, R$ 1.491,13).
--
-- Por que a premissa do omie_id nao colapsa essas views:
-- O omie_id usa `mov:cc:<nCodMovCC>` quando ha movimento bancario e
-- `mov:<nCodTitulo>:<parcela>:<cOrigem>` quando NAO ha. A view-pai (MANP)
-- vem SEM nCodMovCC e a baixa (APBP) COM — chaves distintas, upsert nao
-- colapsa. A limpeza pos-sync e quem deve remover a view-pai redundante.
--
-- Mudancas:
-- 1) Deteccao de baixa: cOrigem IN ('BAXR','BAXP','APBP','APBR') OU
--    presenca de nCodMovCC (movimento bancario real, robusto a origens
--    futuras).
-- 2) A view-pai a remover passa a ser: cOrigem NAO-baixa E SEM nCodMovCC
--    (protege toda baixa bancaria de ser apagada como se fosse pai).
-- 3) Guarda nCodTitulo NOT IN ('0','') — nao agrupa movimentos sem titulo
--    (ex.: tarifas/transferencias EXTP com nCodTitulo=0, que sao lancamentos
--    bancarios legitimos e independentes, nao duplicatas).
--
-- Escopo verificado antes de aplicar (dados de producao): a nova regra
-- deletaria exatamente 18 linhas — 5 na Arte Vista + 13 na Feat Producoes —
-- todas com valor/data/categoria identicos a uma baixa do mesmo titulo.
-- Nenhuma outra empresa e afetada.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cleanup_parent_vs_baixa_duplicates(
  p_company_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  WITH titulos_com_baixa AS (
    SELECT DISTINCT
      fe.company_id,
      COALESCE(
        fe.raw_json -> 'detalhes' ->> 'nCodTitulo',
        fe.raw_json ->> 'nCodTitulo'
      ) AS n_cod_titulo
    FROM public.financial_entries fe
    WHERE (
            UPPER(COALESCE(
              fe.raw_json -> 'detalhes' ->> 'cOrigem',
              fe.raw_json ->> 'cOrigem'
            )) IN ('BAXR', 'BAXP', 'APBP', 'APBR')
            OR NULLIF(COALESCE(
                 fe.raw_json -> 'detalhes' ->> 'nCodMovCC',
                 fe.raw_json ->> 'nCodMovCC'
               ), '') IS NOT NULL
          )
      AND COALESCE(
            fe.raw_json -> 'detalhes' ->> 'nCodTitulo',
            fe.raw_json ->> 'nCodTitulo'
          ) IS NOT NULL
      AND COALESCE(
            fe.raw_json -> 'detalhes' ->> 'nCodTitulo',
            fe.raw_json ->> 'nCodTitulo'
          ) NOT IN ('0', '')
      AND (p_company_id IS NULL OR fe.company_id = p_company_id)
  ),
  to_delete AS (
    SELECT fe.id
    FROM public.financial_entries fe
    JOIN titulos_com_baixa tcb
      ON tcb.company_id = fe.company_id
     AND tcb.n_cod_titulo = COALESCE(
            fe.raw_json -> 'detalhes' ->> 'nCodTitulo',
            fe.raw_json ->> 'nCodTitulo'
          )
    WHERE UPPER(COALESCE(
            fe.raw_json -> 'detalhes' ->> 'cOrigem',
            fe.raw_json ->> 'cOrigem'
          )) NOT IN ('BAXR', 'BAXP', 'APBP', 'APBR')
      AND NULLIF(COALESCE(
            fe.raw_json -> 'detalhes' ->> 'nCodMovCC',
            fe.raw_json ->> 'nCodMovCC'
          ), '') IS NULL
      AND (p_company_id IS NULL OR fe.company_id = p_company_id)
  ),
  deleted AS (
    DELETE FROM public.financial_entries
    WHERE id IN (SELECT id FROM to_delete)
    RETURNING 1
  )
  SELECT COUNT(*)::integer INTO v_deleted FROM deleted;

  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_parent_vs_baixa_duplicates(uuid) TO authenticated;

-- Limpeza global imediata na aplicacao: remove os pais redundantes ja gravados.
SELECT public.cleanup_parent_vs_baixa_duplicates(NULL);
