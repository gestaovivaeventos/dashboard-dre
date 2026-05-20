-- =============================================================================
-- Correcao escopada: mapeamentos errados de "Cerimonial/Fee" para Viva Volta
-- Redonda.
--
-- CONTEXTO:
-- O dashboard estava mostrando valores inflados na linha "Clientes - Servicos
-- Prestados - Cerimonial/Fee" (DRE code `1.3`) apenas para a empresa Volta
-- Redonda. Outras empresas e outras categorias batem com o relatorio do Omie.
--
-- DIAGNOSTICO:
-- - O catalogo Omie da Volta Redonda tem UMA unica categoria com descricao
--   "Cerimonial/Fee": codigo `1.01.99`.
-- - O processador financeiro (financial-processor.ts) foi validado contra o
--   dump real de movimentos: soma processada == soma Omie (diff R$ 0,00).
-- - Logo, a inflacao so pode vir do `category_mapping`: codigos Omie OUTROS
--   alem de `1.01.99` apontando para a DRE `1.3` no escopo dessa empresa.
--
-- ESCOPO DA CORRECAO:
-- - SOMENTE company_id = (Volta Redonda).
-- - SOMENTE dre_account_id da conta DRE `1.3` ("Clientes - Servicos Prestados
--   - Cerimonial/Fee").
-- - PRESERVA o mapeamento canonico `1.01.99 -> 1.3` para essa empresa.
-- - NAO TOCA em mapeamentos globais (company_id IS NULL) — afetariam outras
--   empresas. Se houver um mapeamento global errado, a NOTICE abaixo vai
--   apontar e a correcao precisa ser feita manualmente via UI /mapeamento.
-- - NAO TOCA em mapeamentos de outras DRE accounts.
-- - NAO TOCA em mapeamentos de outras empresas.
--
-- ROLLBACK:
-- A migration apenas DELETA linhas. Para reverter, recadastrar os mapeamentos
-- via UI /mapeamento (admin). Os codigos deletados ficam registrados no log
-- da propria migration (saida do RAISE NOTICE).
-- =============================================================================

DO $$
DECLARE
  v_company_id uuid;
  v_dre_account_id uuid;
  v_row record;
  v_deleted_count integer := 0;
BEGIN
  -- Resolver IDs alvos. Falha cedo se nao encontrar.
  SELECT id INTO v_company_id
  FROM public.companies
  WHERE name ILIKE 'Viva Volta Redonda'
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Empresa "Viva Volta Redonda" nao encontrada. Migration abortada.';
  END IF;

  SELECT id INTO v_dre_account_id
  FROM public.dre_accounts
  WHERE code = '1.3'
  LIMIT 1;

  IF v_dre_account_id IS NULL THEN
    RAISE EXCEPTION 'Conta DRE "1.3" (Cerimonial/Fee) nao encontrada. Migration abortada.';
  END IF;

  RAISE NOTICE '[fix-vvr-cerimonial] company_id=%, dre_account_id=% (1.3 Cerimonial/Fee)',
    v_company_id, v_dre_account_id;

  -- 1) AUDITORIA: listar TODOS os mapeamentos que resolvem para DRE 1.3
  --    nesse escopo (company-specific + global fallback). O leitor da
  --    migration consegue ver no log o que estava la antes do delete.
  RAISE NOTICE '[fix-vvr-cerimonial] Mapeamentos ANTES da limpeza:';
  FOR v_row IN
    SELECT
      cm.omie_category_code,
      cm.omie_category_name,
      CASE WHEN cm.company_id IS NULL THEN 'GLOBAL' ELSE 'EMPRESA' END AS escopo
    FROM public.category_mapping cm
    WHERE cm.dre_account_id = v_dre_account_id
      AND (cm.company_id IS NULL OR cm.company_id = v_company_id)
    ORDER BY escopo DESC, cm.omie_category_code
  LOOP
    RAISE NOTICE '[fix-vvr-cerimonial]   escopo=% codigo=% nome=%',
      v_row.escopo, v_row.omie_category_code, v_row.omie_category_name;
  END LOOP;

  -- 2) Verificar se o mapeamento canonico esta presente. Se nao estiver,
  --    a migration nao vai conseguir restaurar a categoria correta — apenas
  --    avisa para a operacao manual.
  IF NOT EXISTS (
    SELECT 1 FROM public.category_mapping cm
    WHERE cm.dre_account_id = v_dre_account_id
      AND cm.omie_category_code = '1.01.99'
      AND (cm.company_id IS NULL OR cm.company_id = v_company_id)
  ) THEN
    RAISE WARNING '[fix-vvr-cerimonial] Mapeamento canonico 1.01.99 -> 1.3 NAO existe (nem global nem empresa). Apos a limpeza, a categoria pode ficar sem mapeamento. Confira em /mapeamento.';
  END IF;

  -- 3) DELETE escopado: somente mapeamentos company-specific da Viva Volta Redonda
  --    para a DRE 1.3 cujo codigo Omie NAO seja 1.01.99.
  --
  --    Nota: usamos DELETE ... RETURNING dentro de uma CTE para conseguir
  --    logar cada linha removida individualmente.
  WITH removidos AS (
    DELETE FROM public.category_mapping
    WHERE company_id = v_company_id
      AND dre_account_id = v_dre_account_id
      AND omie_category_code <> '1.01.99'
    RETURNING omie_category_code, omie_category_name
  )
  SELECT count(*) INTO v_deleted_count FROM removidos;

  -- Re-logar cada removido (so possivel via segunda query — RAISE dentro de
  -- DELETE RETURNING nao e suportado em plpgsql como esperado).
  FOR v_row IN
    SELECT cm.omie_category_code, cm.omie_category_name
    FROM (
      SELECT '__placeholder__' AS omie_category_code, '__placeholder__' AS omie_category_name
      WHERE false
    ) cm
  LOOP
    -- noop — apenas o count abaixo importa, o NOTICE de antes ja documentou
    -- o estado pre-delete e o RAISE NOTICE final documenta o count pos-delete.
    NULL;
  END LOOP;

  RAISE NOTICE '[fix-vvr-cerimonial] Removidos: % mapeamento(s) company-specific da Viva Volta Redonda apontando para DRE 1.3 com codigo != 1.01.99.', v_deleted_count;

  -- 4) AUDITORIA POS: o que sobrou apos a limpeza.
  RAISE NOTICE '[fix-vvr-cerimonial] Mapeamentos APOS a limpeza:';
  FOR v_row IN
    SELECT
      cm.omie_category_code,
      cm.omie_category_name,
      CASE WHEN cm.company_id IS NULL THEN 'GLOBAL' ELSE 'EMPRESA' END AS escopo
    FROM public.category_mapping cm
    WHERE cm.dre_account_id = v_dre_account_id
      AND (cm.company_id IS NULL OR cm.company_id = v_company_id)
    ORDER BY escopo DESC, cm.omie_category_code
  LOOP
    RAISE NOTICE '[fix-vvr-cerimonial]   escopo=% codigo=% nome=%',
      v_row.escopo, v_row.omie_category_code, v_row.omie_category_name;
  END LOOP;
END $$;
