-- =============================================================================
-- Corrige a hierarquia parent_id da estrutura de Fluxo de Caixa.
--
-- A migration original (20260506140000_cash_flow_module) usou um CTE modificador
-- (INSERT ... RETURNING) e em seguida tentou popular parent_id num UPDATE ...
-- FROM no MESMO statement. Pela semantica de snapshot do PostgreSQL, o UPDATE
-- externo nao enxergou as linhas recem-inseridas, entao TODAS as contas de
-- Fluxo de Caixa terminaram com parent_id = NULL. Resultado: a tela renderiza
-- uma lista plana ordenada apenas por sort_order, com os pais misturados aos
-- filhos (ex: "Emprestimos Bancarios" antes de "Emprestimos e Mutuos").
--
-- Esta migration:
--   1. Refaz o linkage parent_id -> id baseado no prefixo do code
--      ('2.1' -> code='2', '3.4' -> code='3', etc). Idempotente.
--   2. Renomeia '5.1' de 'Aumento de Capital' para 'Aportes' conforme
--      especificacao atualizada da estrutura.
-- =============================================================================

UPDATE public.cash_flow_accounts AS child
SET parent_id = parent.id
FROM public.cash_flow_accounts AS parent
WHERE parent.code = split_part(child.code, '.', 1)
  AND child.code LIKE '%.%'
  AND child.code NOT LIKE '90.%'   -- bloco destaque (Saldo Inicial / Caixa Gerado / Caixa Final) nao tem hierarquia
  AND parent.id <> child.id
  AND child.parent_id IS DISTINCT FROM parent.id;

UPDATE public.cash_flow_accounts
SET name = 'Aportes'
WHERE code = '5.1' AND name <> 'Aportes';
