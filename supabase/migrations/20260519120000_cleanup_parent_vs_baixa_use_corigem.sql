-- =============================================================================
-- Fix: cleanup_parent_vs_baixa_duplicates passa a identificar baixas pelo
-- cOrigem do raw_json (BAXR/BAXP) em vez do prefixo de omie_id.
--
-- Contexto:
-- A versao anterior (migration 20260430120000_dedupe_parent_vs_baixa_robust)
-- so reconhecia baixas com omie_id no formato legado `bx:%`. Quando o
-- processador passou a usar `mov:cc:<nCodMovCC>` para baixas com movimento
-- bancario, a deteccao deixou de funcionar e os registros-pai
-- (MANR/MANP/EXTR/EXTP/RPTR/RPTP/...) deixados em syncs anteriores
-- (quando o pai veio sem suas baixas no mesmo lote) nao eram mais
-- suprimidos pela limpeza pos-sync.
--
-- Por que o pai aparece sem as baixas:
-- O dDtPagamento do registro pai-MANR e atualizado pela Omie apenas quando
-- o titulo e quitado (data da ultima baixa). Um sync incremental que
-- inclua essa data pega o pai mas nao as baixas anteriores (fora do
-- range). O pai entra no lote sozinho, processMovimento o trata como
-- lancamento standalone e o insere com value = nValPago/nValLiquido
-- (cumulativo do titulo) na data de fechamento, inflando o DRE.
--
-- Um Full Sync posterior pegaria pai + baixas no mesmo lote e o pai
-- seria suprimido pelo processMovimentos. Mas o cleanup pos-sync nao
-- removia os pais inseridos em syncs anteriores se a baixa correspondente
-- usava o novo formato `mov:cc:%`.
--
-- Sintoma observado: titulo 6290440982 da Cuiaba (Aluguel Rodrigo Fonseca)
-- mantinha 2 entries MANR de 22/01/2026 (R$ 19.933,58 + R$ 0,00) inflando
-- a categoria "Receitas Nao Operacionais" no DRE de Jan/2026 mesmo apos
-- todas as 5 baixas reais (Jul/Ago/Dez 2025) terem sido importadas
-- corretamente.
--
-- Mudancas:
-- 1) Deteccao de baixas via cOrigem em raw_json (BAXR/BAXP) — robusto a
--    qualquer formato de omie_id (legado bx:%, atual mov:cc:%, futuro).
-- 2) Deteccao de pais via cOrigem != BAXR/BAXP no raw_json.
-- 3) Match por nCodTitulo do raw_json (em vez de split do omie_id).
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
    WHERE UPPER(COALESCE(
            fe.raw_json -> 'detalhes' ->> 'cOrigem',
            fe.raw_json ->> 'cOrigem'
          )) IN ('BAXR', 'BAXP')
      AND COALESCE(
            fe.raw_json -> 'detalhes' ->> 'nCodTitulo',
            fe.raw_json ->> 'nCodTitulo'
          ) IS NOT NULL
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
          )) NOT IN ('BAXR', 'BAXP')
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

-- Limpeza global imediata: roda em todas as empresas para remover pais
-- orfaos remanescentes.
SELECT public.cleanup_parent_vs_baixa_duplicates(NULL);
