-- =============================================================================
-- SEED DE TESTE — clona as categorias de DESPESA da "Viva Campo Grande" para a
-- empresa fictícia "TESTE MÓDULO ORÇAMENTO", para permitir testar o módulo
-- Orçamento (tela de método por categoria) sem mexer em empresas reais.
--
-- SEGURANÇA:
--   • A Viva Campo Grande é apenas LIDA (SELECT). Nada nela é alterado.
--   • Todos os INSERTs usam company_id da empresa de TESTE.
--   • A empresa de teste não tem lançamentos nem credencial Omie, então nada de
--     DRE/dashboard/sync/cron é afetado — as categorias só passam a existir para
--     ela própria.
--   • Idempotente (WHERE NOT EXISTS) — reaplicar não duplica.
--   • Falha explícita se alguma das empresas não for encontrada (evita no-op
--     silencioso por diferença de nome).
--
-- O que é copiado: as categorias EFETIVAS de despesa da Viva Campo Grande — as
-- específicas dela mais as globais (company_id null) que ela herda — cada uma
-- resolvida para a linha DRE que a Viva Campo Grande usa. O específico vence o
-- global quando o mesmo código existe nos dois.
-- =============================================================================

DO $$
DECLARE
  v_test_id   uuid;
  v_source_id uuid;
  v_inserted  integer;
BEGIN
  SELECT id INTO v_test_id
  FROM public.companies
  WHERE btrim(name) ILIKE 'Teste Módulo Orçamento'
  LIMIT 1;

  SELECT id INTO v_source_id
  FROM public.companies
  WHERE btrim(name) ILIKE 'Viva Campo Grande'
  LIMIT 1;

  IF v_test_id IS NULL THEN
    RAISE EXCEPTION 'Empresa de teste "TESTE MÓDULO ORÇAMENTO" não encontrada — confira o nome exato em companies.';
  END IF;
  IF v_source_id IS NULL THEN
    RAISE EXCEPTION 'Empresa de origem "Viva Campo Grande" não encontrada — confira o nome exato em companies.';
  END IF;

  WITH src AS (
    SELECT DISTINCT ON (cm.omie_category_code)
      cm.omie_category_code,
      cm.omie_category_name,
      cm.dre_account_id
    FROM public.category_mapping cm
    JOIN public.dre_accounts da ON da.id = cm.dre_account_id
    WHERE (cm.company_id = v_source_id OR cm.company_id IS NULL)
      AND da.type = 'despesa'
    -- Específico da Viva CG vence o global para o mesmo código de categoria.
    ORDER BY cm.omie_category_code, (cm.company_id = v_source_id) DESC NULLS LAST
  )
  INSERT INTO public.category_mapping (company_id, omie_category_code, omie_category_name, dre_account_id)
  SELECT v_test_id, src.omie_category_code, src.omie_category_name, src.dre_account_id
  FROM src
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.category_mapping x
    WHERE x.company_id = v_test_id
      AND x.omie_category_code = src.omie_category_code
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RAISE NOTICE 'Categorias de despesa clonadas para a empresa de teste: %', v_inserted;
END $$;
