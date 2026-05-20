-- =============================================================================
-- RESTAURACAO DO PLANO GLOBAL DE DRE_ACCOUNTS
-- =============================================================================
-- Repõe as contas deletadas (1.1, 1.3, 20, 20.1, 20.2, 21, 22, 23, 24, 24.x),
-- renomeia 1.2 de volta ao nome canonico, e corrige a formula corrompida da
-- conta 5.
--
-- Defensivo:
--   - INSERTs usam WHERE NOT EXISTS — nao quebra se a conta ja existir
--   - UPDATEs de parent_id usam IS DISTINCT FROM — só atualizam quando precisam
--   - Wrapped em BEGIN/COMMIT — se algo falhar, nada e aplicado
--
-- Os triggers de Phase 1 (dre_accounts_set_level e check_parent_scope)
-- continuam ativos durante esta migration e validam as inserções.
--
-- NAO restaura:
--   - Mapeamentos category_mapping cascade-deletados (precisam ser refeitos via UI)
--   - budget_entries cascade-deletados (precisam ser reimportados)
--
-- Para testar sem aplicar, troque o COMMIT do final por ROLLBACK.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Restaurar 1.1 e 1.3 (filhos da conta 1)
-- -----------------------------------------------------------------------------
DO $restore_1x$
DECLARE
  v_parent_id uuid;
BEGIN
  SELECT id INTO v_parent_id
  FROM public.dre_accounts
  WHERE code = '1' AND company_id IS NULL;

  IF v_parent_id IS NULL THEN
    RAISE EXCEPTION 'Conta pai 1 nao encontrada no plano global - abort.';
  END IF;

  INSERT INTO public.dre_accounts
    (code, name, parent_id, level, type, is_summary, formula, sort_order, active, company_id)
  SELECT '1.1', 'Clientes - Serviços Prestados - Assessoria', v_parent_id, 2,
         'receita'::public.dre_account_type, false, NULL, 1, true, NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM public.dre_accounts WHERE code = '1.1' AND company_id IS NULL
  );

  INSERT INTO public.dre_accounts
    (code, name, parent_id, level, type, is_summary, formula, sort_order, active, company_id)
  SELECT '1.3', 'Clientes - Serviços Prestados - Cerimonial/Fee', v_parent_id, 2,
         'receita'::public.dre_account_type, false, NULL, 3, true, NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM public.dre_accounts WHERE code = '1.3' AND company_id IS NULL
  );

  RAISE NOTICE '[1.1 e 1.3] verificadas / restauradas';
END
$restore_1x$;

-- -----------------------------------------------------------------------------
-- 2) Renomear 1.2 de volta para o nome canonico
-- -----------------------------------------------------------------------------
UPDATE public.dre_accounts
SET name = 'Clientes - Margem de Contribuição de Eventos'
WHERE code = '1.2'
  AND company_id IS NULL
  AND name <> 'Clientes - Margem de Contribuição de Eventos';

-- -----------------------------------------------------------------------------
-- 3) Restaurar conta 20 + filhos 20.1 e 20.2
-- -----------------------------------------------------------------------------
DO $restore_20$
DECLARE
  v_parent_id uuid;
BEGIN
  INSERT INTO public.dre_accounts
    (code, name, parent_id, level, type, is_summary, formula, sort_order, active, company_id)
  SELECT '20', 'Empréstimos e Mútuos', NULL, 1,
         'misto'::public.dre_account_type, true, NULL, 20, true, NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM public.dre_accounts WHERE code = '20' AND company_id IS NULL
  );

  SELECT id INTO v_parent_id
  FROM public.dre_accounts
  WHERE code = '20' AND company_id IS NULL;

  INSERT INTO public.dre_accounts
    (code, name, parent_id, level, type, is_summary, formula, sort_order, active, company_id)
  SELECT '20.1', 'Entradas', v_parent_id, 2,
         'receita'::public.dre_account_type, false, NULL, 1, true, NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM public.dre_accounts WHERE code = '20.1' AND company_id IS NULL
  );

  INSERT INTO public.dre_accounts
    (code, name, parent_id, level, type, is_summary, formula, sort_order, active, company_id)
  SELECT '20.2', 'Saídas', v_parent_id, 2,
         'despesa'::public.dre_account_type, false, NULL, 2, true, NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM public.dre_accounts WHERE code = '20.2' AND company_id IS NULL
  );

  -- Caso 20.1 ou 20.2 ja existissem com parent_id errado (orfaos ou
  -- pais diferentes), re-atrela ao 20 recem-restaurado
  UPDATE public.dre_accounts
  SET parent_id = v_parent_id
  WHERE code IN ('20.1', '20.2')
    AND company_id IS NULL
    AND parent_id IS DISTINCT FROM v_parent_id;

  RAISE NOTICE '[20 + 20.1 + 20.2] restauradas e hierarquia fixada';
END
$restore_20$;

-- -----------------------------------------------------------------------------
-- 4) Restaurar 21, 22, 23 (totais sem filhos)
-- -----------------------------------------------------------------------------
INSERT INTO public.dre_accounts
  (code, name, parent_id, level, type, is_summary, formula, sort_order, active, company_id)
SELECT '21', 'Investimentos', NULL, 1,
       'despesa'::public.dre_account_type, true, NULL, 21, true, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.dre_accounts WHERE code = '21' AND company_id IS NULL
);

INSERT INTO public.dre_accounts
  (code, name, parent_id, level, type, is_summary, formula, sort_order, active, company_id)
SELECT '22', 'Dividendos', NULL, 1,
       'despesa'::public.dre_account_type, true, NULL, 22, true, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.dre_accounts WHERE code = '22' AND company_id IS NULL
);

INSERT INTO public.dre_accounts
  (code, name, parent_id, level, type, is_summary, formula, sort_order, active, company_id)
SELECT '23', 'Aportes', NULL, 1,
       'receita'::public.dre_account_type, true, NULL, 23, true, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.dre_accounts WHERE code = '23' AND company_id IS NULL
);

-- -----------------------------------------------------------------------------
-- 5) Restaurar conta 24 (Fluxo de Caixa) + filhos 24.1, 24.2, 24.3, 24.4
-- -----------------------------------------------------------------------------
DO $restore_24$
DECLARE
  v_parent_id uuid;
BEGIN
  INSERT INTO public.dre_accounts
    (code, name, parent_id, level, type, is_summary, formula, sort_order, active, company_id)
  SELECT '24', 'Fluxo de Caixa', NULL, 1,
         'calculado'::public.dre_account_type, true, '24.1+24.2-24.3', 24, true, NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM public.dre_accounts WHERE code = '24' AND company_id IS NULL
  );

  SELECT id INTO v_parent_id
  FROM public.dre_accounts
  WHERE code = '24' AND company_id IS NULL;

  INSERT INTO public.dre_accounts
    (code, name, parent_id, level, type, is_summary, formula, sort_order, active, company_id)
  SELECT '24.1', 'Saldo Inicial', v_parent_id, 2,
         'misto'::public.dre_account_type, false, NULL, 1, true, NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM public.dre_accounts WHERE code = '24.1' AND company_id IS NULL
  );

  INSERT INTO public.dre_accounts
    (code, name, parent_id, level, type, is_summary, formula, sort_order, active, company_id)
  SELECT '24.2', 'Entradas', v_parent_id, 2,
         'calculado'::public.dre_account_type, true, '1+2+9+20.1+23', 2, true, NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM public.dre_accounts WHERE code = '24.2' AND company_id IS NULL
  );

  INSERT INTO public.dre_accounts
    (code, name, parent_id, level, type, is_summary, formula, sort_order, active, company_id)
  SELECT '24.3', 'Saídas', v_parent_id, 2,
         'calculado'::public.dre_account_type, true, '3+5+7+10+20.2+21+22', 3, true, NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM public.dre_accounts WHERE code = '24.3' AND company_id IS NULL
  );

  INSERT INTO public.dre_accounts
    (code, name, parent_id, level, type, is_summary, formula, sort_order, active, company_id)
  SELECT '24.4', 'Saldo Final', v_parent_id, 2,
         'calculado'::public.dre_account_type, true, '24.1+24.2-24.3', 4, true, NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM public.dre_accounts WHERE code = '24.4' AND company_id IS NULL
  );

  -- Re-atrela filhos caso existissem orfaos
  UPDATE public.dre_accounts
  SET parent_id = v_parent_id
  WHERE code IN ('24.1', '24.2', '24.3', '24.4')
    AND company_id IS NULL
    AND parent_id IS DISTINCT FROM v_parent_id;

  RAISE NOTICE '[24 + filhos] restauradas e hierarquia fixada';
END
$restore_24$;

-- -----------------------------------------------------------------------------
-- 6) Corrigir formula CORROMPIDA da conta 5 (CRITICO - estava quebrando DRE)
--    Valor correto vem da migration 20260402140000_custos_subtract_receitas_ressarciveis
-- -----------------------------------------------------------------------------
UPDATE public.dre_accounts
SET formula    = '5.1+5.2+5.3+5.4+5.5+5.6+5.7+5.8+5.9+5.10-2.4',
    type       = 'calculado'::public.dre_account_type,
    is_summary = true
WHERE code = '5'
  AND company_id IS NULL;

-- -----------------------------------------------------------------------------
-- VERIFICACAO FINAL: mostra o estado das contas restauradas
-- -----------------------------------------------------------------------------
SELECT
  d.code,
  d.name,
  d.type::text                                                    AS type,
  d.is_summary,
  COALESCE(d.formula, '<sem formula>')                            AS formula,
  COALESCE(
    (SELECT p.code FROM public.dre_accounts p WHERE p.id = d.parent_id),
    '<root>'
  )                                                               AS parent_code
FROM public.dre_accounts d
WHERE d.company_id IS NULL
  AND d.code IN (
    '1','1.1','1.2','1.3','5',
    '20','20.1','20.2',
    '21','22','23',
    '24','24.1','24.2','24.3','24.4'
  )
ORDER BY d.code;

-- =============================================================================
-- Se a verificacao acima mostrar tudo correto, comite a transacao.
-- Para CONFIRMAR as mudancas: deixe a linha COMMIT abaixo.
-- Para CANCELAR e nao aplicar nada: troque COMMIT por ROLLBACK.
-- =============================================================================
COMMIT;
