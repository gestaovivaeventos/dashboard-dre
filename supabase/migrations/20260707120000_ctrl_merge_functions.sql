-- Funções de mesclagem (merge) de setores e tipos de despesa.
--
-- Repontam TODOS os vínculos de um registro de origem para um de destino,
-- resolvendo colisões de unicidade, e inativam a origem ao final (não excluem,
-- preservando histórico). Cada função executa numa única transação.
--
-- Regras de colisão (definidas com o negócio):
--   • ctrl_budget  → NÃO soma. Na colisão (mesmo tipo/setor/ano/mês) mantém a
--                    linha do destino e descarta a da origem. O upload da
--                    planilha regrava o ano de qualquer forma.
--   • vínculos únicos (fornecedor↔tipo, usuário↔setor) → deduplica.
--   • mapeamentos Omie da origem → descartados (serão remapeados).
--
-- SECURITY DEFINER: a escrita nessas tabelas exige is_admin() no RLS. A
-- autorização real é feita na server action (requireCtrlRole('csc','admin')) e
-- a execução é liberada apenas para service_role (client admin do app).

-- ── Setores ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ctrl_merge_sectors(p_source uuid, p_target uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_source IS NULL OR p_target IS NULL THEN
    RAISE EXCEPTION 'Origem e destino são obrigatórios.';
  END IF;
  IF p_source = p_target THEN
    RAISE EXCEPTION 'Não é possível mesclar um setor nele mesmo.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ctrl_sectors WHERE id = p_source) THEN
    RAISE EXCEPTION 'Setor de origem não encontrado.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ctrl_sectors WHERE id = p_target) THEN
    RAISE EXCEPTION 'Setor de destino não encontrado.';
  END IF;

  -- Requisições: repontar direto (sem unicidade).
  UPDATE ctrl_requests SET sector_id = p_target WHERE sector_id = p_source;

  -- Orçamento: descartar linhas da origem que colidem com o destino (não soma),
  -- depois mover as restantes. NULLs de expense_type_id são distintos no UNIQUE,
  -- então nunca colidem e são movidos sem violação.
  DELETE FROM ctrl_budget b
   WHERE b.sector_id = p_source
     AND EXISTS (
       SELECT 1 FROM ctrl_budget t
        WHERE t.sector_id = p_target
          AND t.expense_type_id = b.expense_type_id
          AND t.period_year = b.period_year
          AND t.period_month = b.period_month
     );
  UPDATE ctrl_budget SET sector_id = p_target WHERE sector_id = p_source;

  -- Vínculos usuário↔setor (tabela criada fora deste repo — guardar existência).
  IF to_regclass('public.user_sectors') IS NOT NULL THEN
    DELETE FROM user_sectors us
     WHERE us.sector_id = p_source
       AND EXISTS (
         SELECT 1 FROM user_sectors t
          WHERE t.user_id = us.user_id AND t.sector_id = p_target
       );
    UPDATE user_sectors SET sector_id = p_target WHERE sector_id = p_source;
  END IF;

  -- Mapeamento Omie por setor: descartar os da origem (serão remapeados).
  IF to_regclass('public.ctrl_sector_omie_departamento') IS NOT NULL THEN
    DELETE FROM ctrl_sector_omie_departamento WHERE sector_id = p_source;
  END IF;

  -- Inativa a origem — preserva histórico.
  UPDATE ctrl_sectors SET active = false WHERE id = p_source;
END;
$$;

-- ── Tipos de despesa ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ctrl_merge_expense_types(p_source uuid, p_target uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_source IS NULL OR p_target IS NULL THEN
    RAISE EXCEPTION 'Origem e destino são obrigatórios.';
  END IF;
  IF p_source = p_target THEN
    RAISE EXCEPTION 'Não é possível mesclar um tipo de despesa nele mesmo.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ctrl_expense_types WHERE id = p_source) THEN
    RAISE EXCEPTION 'Tipo de despesa de origem não encontrado.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ctrl_expense_types WHERE id = p_target) THEN
    RAISE EXCEPTION 'Tipo de despesa de destino não encontrado.';
  END IF;

  -- Requisições: repontar direto.
  UPDATE ctrl_requests SET expense_type_id = p_target WHERE expense_type_id = p_source;

  -- Orçamento: descartar colisões da origem (não soma), mover o restante.
  DELETE FROM ctrl_budget b
   WHERE b.expense_type_id = p_source
     AND EXISTS (
       SELECT 1 FROM ctrl_budget t
        WHERE t.expense_type_id = p_target
          AND t.sector_id = b.sector_id
          AND t.period_year = b.period_year
          AND t.period_month = b.period_month
     );
  UPDATE ctrl_budget SET expense_type_id = p_target WHERE expense_type_id = p_source;

  -- Vínculo fornecedor↔tipo: deduplicar antes de repontar.
  DELETE FROM ctrl_supplier_expense_types s
   WHERE s.expense_type_id = p_source
     AND EXISTS (
       SELECT 1 FROM ctrl_supplier_expense_types t
        WHERE t.supplier_id = s.supplier_id AND t.expense_type_id = p_target
     );
  UPDATE ctrl_supplier_expense_types SET expense_type_id = p_target WHERE expense_type_id = p_source;

  -- Mapeamento Omie por tipo: descartar os da origem (serão remapeados).
  IF to_regclass('public.ctrl_expense_type_omie_categoria') IS NOT NULL THEN
    DELETE FROM ctrl_expense_type_omie_categoria WHERE expense_type_id = p_source;
  END IF;

  -- Inativa a origem — preserva histórico.
  UPDATE ctrl_expense_types SET active = false WHERE id = p_source;
END;
$$;

-- Execução restrita ao service_role (client admin do app). Impede que um usuário
-- autenticado chame a função SECURITY DEFINER direto, contornando o gate de role.
REVOKE EXECUTE ON FUNCTION public.ctrl_merge_sectors(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ctrl_merge_expense_types(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ctrl_merge_sectors(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ctrl_merge_expense_types(uuid, uuid) TO service_role;
