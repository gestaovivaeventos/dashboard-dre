-- =============================================================================
-- Correcao escopada: duplicatas residuais em Cerimonial/Fee, Volta Redonda,
-- Mar/Abr 2023.
--
-- SINTOMA OBSERVADO PELO USUARIO:
-- - Empresa: Viva Volta Redonda
-- - Categoria DRE: "Clientes - Servicos Prestados - Cerimonial/Fee" (code 1.3)
-- - Categoria Omie: 1.01.99 (unica com essa descricao no catalogo da empresa)
-- - Meses afetados: 03/2023 e 04/2023 APENAS
--   * Mar 2023: Sistema R$ 95.724,80 vs Omie R$ 56.688,90 (+R$ 39.035,90)
--   * Abr 2023: Sistema R$ 99.679,78 vs Omie R$ 73.515,68 (+R$ 26.164,10)
-- - Jan/Fev/Mai/Jun batem perfeitamente.
--
-- DIAGNOSTICO:
-- Mapeamento descartado: afetaria TODOS os meses, nao so 2 meses isolados.
-- Processador validado contra dump real: soma processada == soma Omie.
-- Causa residual: entries duplicadas que escaparam dos cleanups existentes.
--   * `dedupe_financial_entries_by_ncodmovcc` so consolida quando `nCodMovCC`
--     esta preenchido. Entries antigas sem `nCodMovCC` (lancamentos manuais
--     na Omie, pre-conciliacao bancaria) ficam como par pai+baixa com
--     omie_ids diferentes — ambos sobrevivem o `cleanup_obsolete_entries`
--     porque AMBOS estao no `valid_omie_ids` da sync atual.
--   * `cleanup_parent_vs_baixa_duplicates` so atua quando o pai tem prefixo
--     `mov:` e a baixa `bx:` — quando o nCodMovCC esta presente, a baixa
--     usa prefixo `mov:cc:` (igual ao pai) e a regra do cleanup nao aciona.
--
-- ESCOPO DA CORRECAO (restrito ao maximo):
-- - Empresa: APENAS Volta Redonda (resolvida via name ILIKE 'volta redonda')
-- - Categoria: APENAS '1.01.99' (Cerimonial/Fee no catalogo Omie)
-- - Periodo: APENAS 2023-03-01 a 2023-04-30
-- - Operacao: DELETE de duplicatas por chave de conteudo, mantendo a entry
--   mais recente (created_at desc). A chave inclui valor + data + cliente +
--   documento — coincidir em todos esses campos significa estatisticamente
--   a mesma transacao Omie registrada com omie_ids diferentes.
--
-- NAO afeta:
-- - Outras empresas
-- - Outras categorias DRE
-- - Outras categorias Omie
-- - Outros meses (mesmo de 2023)
-- - `category_mapping` (nao removemos mapeamentos)
--
-- ROLLBACK:
-- Para reverter as entries removidas: rodar Full Sync da empresa novamente.
-- O sync re-busca os movimentos da Omie e re-popula `financial_entries`.
-- =============================================================================

DO $$
DECLARE
  v_company_id uuid;
  v_row record;
  v_deleted_count integer := 0;
  v_total_before numeric;
  v_total_after numeric;
BEGIN
  -- Resolver company_id da Volta Redonda. Falha cedo se nao encontrar.
  SELECT id INTO v_company_id
  FROM public.companies
  WHERE name ILIKE 'Viva Volta Redonda'
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION '[fix-vvr-cerimonial] Empresa "Viva Volta Redonda" nao encontrada. Migration abortada.';
  END IF;

  RAISE NOTICE '[fix-vvr-cerimonial] company_id=%', v_company_id;

  -- ===========================================================================
  -- 1) DIAGNOSTICO ANTES: soma total + listagem de entries
  -- ===========================================================================
  SELECT COALESCE(SUM(value), 0) INTO v_total_before
  FROM public.financial_entries
  WHERE company_id = v_company_id
    AND category_code = '1.01.99'
    AND payment_date BETWEEN DATE '2023-03-01' AND DATE '2023-04-30';

  RAISE NOTICE '[fix-vvr-cerimonial] Total Cerimonial Mar+Abr 2023 ANTES: R$ %', v_total_before;

  RAISE NOTICE '[fix-vvr-cerimonial] Entries antes da limpeza:';
  FOR v_row IN
    SELECT
      fe.id,
      fe.omie_id,
      fe.payment_date,
      fe.value,
      LEFT(COALESCE(fe.description, ''), 40) AS desc_short,
      COALESCE(fe.supplier_customer, '') AS supplier,
      COALESCE(fe.document_number, '') AS docnum,
      COALESCE(
        fe.raw_json -> 'detalhes' ->> 'nCodTitulo',
        fe.raw_json ->> 'nCodTitulo'
      ) AS ncodtit,
      COALESCE(
        fe.raw_json -> 'detalhes' ->> 'nCodMovCC',
        fe.raw_json ->> 'nCodMovCC'
      ) AS ncodmovcc,
      COALESCE(
        fe.raw_json -> 'detalhes' ->> 'cOrigem',
        fe.raw_json ->> 'cOrigem'
      ) AS origem,
      fe.created_at
    FROM public.financial_entries fe
    WHERE fe.company_id = v_company_id
      AND fe.category_code = '1.01.99'
      AND fe.payment_date BETWEEN DATE '2023-03-01' AND DATE '2023-04-30'
    ORDER BY fe.payment_date, fe.value DESC, fe.created_at
  LOOP
    RAISE NOTICE '[fix-vvr-cerimonial]   date=% value=% ncodtit=% ncodmovcc=% origem=% omie_id=% supplier=% doc=% desc=%',
      v_row.payment_date, v_row.value, v_row.ncodtit, v_row.ncodmovcc,
      v_row.origem, v_row.omie_id, v_row.supplier, v_row.docnum, v_row.desc_short;
  END LOOP;

  -- ===========================================================================
  -- 2) IDENTIFICAR GRUPOS DE DUPLICATAS (chave de conteudo)
  -- ===========================================================================
  -- Considera duplicata quando MULTIPLAS entries compartilham TODOS:
  --   - payment_date
  --   - value
  --   - supplier_customer (cliente/fornecedor)
  --   - document_number (NF/RP/numero do titulo)
  --   - description
  -- Probabilidade de coincidencia entre transacoes reais distintas e
  -- praticamente zero — esses 5 campos juntos identificam unicamente a
  -- transacao Omie.
  -- ===========================================================================
  RAISE NOTICE '[fix-vvr-cerimonial] Grupos de duplicatas detectados:';
  FOR v_row IN
    WITH grouped AS (
      SELECT
        fe.payment_date,
        fe.value,
        COALESCE(fe.supplier_customer, '') AS supplier,
        COALESCE(fe.document_number, '') AS docnum,
        COALESCE(fe.description, '') AS desc_full,
        COUNT(*) AS qtd,
        STRING_AGG(fe.omie_id, ' | ' ORDER BY fe.created_at DESC) AS omie_ids
      FROM public.financial_entries fe
      WHERE fe.company_id = v_company_id
        AND fe.category_code = '1.01.99'
        AND fe.payment_date BETWEEN DATE '2023-03-01' AND DATE '2023-04-30'
      GROUP BY 1, 2, 3, 4, 5
      HAVING COUNT(*) > 1
    )
    SELECT * FROM grouped ORDER BY qtd DESC, value DESC
  LOOP
    RAISE NOTICE '[fix-vvr-cerimonial]   qtd=% date=% value=% supplier=% doc=% omie_ids=[%]',
      v_row.qtd, v_row.payment_date, v_row.value,
      LEFT(v_row.supplier, 30), v_row.docnum, v_row.omie_ids;
  END LOOP;

  -- ===========================================================================
  -- 3) DELETE: manter so a entry mais recente em cada grupo de duplicatas
  -- ===========================================================================
  -- Ordem de preferencia para manter (do mais para o menos preferido):
  --   1. Entries com nCodMovCC preenchido (formato moderno, mais confiavel)
  --   2. Mais recentes por created_at
  --   3. ID maior (tiebreaker deterministico)
  WITH ranked AS (
    SELECT
      fe.id,
      ROW_NUMBER() OVER (
        PARTITION BY
          fe.payment_date,
          fe.value,
          COALESCE(fe.supplier_customer, ''),
          COALESCE(fe.document_number, ''),
          COALESCE(fe.description, '')
        ORDER BY
          CASE
            WHEN COALESCE(
              fe.raw_json -> 'detalhes' ->> 'nCodMovCC',
              fe.raw_json ->> 'nCodMovCC'
            ) IS NOT NULL THEN 0
            ELSE 1
          END,
          fe.created_at DESC,
          fe.id DESC
      ) AS rn
    FROM public.financial_entries fe
    WHERE fe.company_id = v_company_id
      AND fe.category_code = '1.01.99'
      AND fe.payment_date BETWEEN DATE '2023-03-01' AND DATE '2023-04-30'
  ),
  deleted AS (
    DELETE FROM public.financial_entries
    WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_deleted_count FROM deleted;

  RAISE NOTICE '[fix-vvr-cerimonial] Duplicatas removidas: %', v_deleted_count;

  -- ===========================================================================
  -- 4) DIAGNOSTICO DEPOIS: soma total + lista pos-limpeza
  -- ===========================================================================
  SELECT COALESCE(SUM(value), 0) INTO v_total_after
  FROM public.financial_entries
  WHERE company_id = v_company_id
    AND category_code = '1.01.99'
    AND payment_date BETWEEN DATE '2023-03-01' AND DATE '2023-04-30';

  RAISE NOTICE '[fix-vvr-cerimonial] Total Cerimonial Mar+Abr 2023 DEPOIS: R$ %', v_total_after;
  RAISE NOTICE '[fix-vvr-cerimonial] Valor liberado: R$ %', (v_total_before - v_total_after);

  -- Valor esperado pelo Omie: 56.688,90 (Mar) + 73.515,68 (Abr) = 130.204,58
  IF ABS(v_total_after - 130204.58) < 0.01 THEN
    RAISE NOTICE '[fix-vvr-cerimonial] OK: total bateu exatamente com o esperado da Omie (R$ 130.204,58).';
  ELSE
    RAISE NOTICE '[fix-vvr-cerimonial] AVISO: total (R$ %) ainda nao bate com o esperado da Omie (R$ 130.204,58). Diferenca residual: R$ %.',
      v_total_after, (v_total_after - 130204.58);
  END IF;
END $$;
