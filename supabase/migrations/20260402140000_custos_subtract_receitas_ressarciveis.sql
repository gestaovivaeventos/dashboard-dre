-- Conta 5 (Custos com os Servicos Prestados):
-- Subtrai a conta 2.4 (Receitas Ressarciveis) do total.
-- A conta 2.4 continua exibida com valor positivo na sua linha,
-- mas reduz o subtotal de Custos.
--
-- Formula: soma dos filhos (5.1 a 5.10) menos 2.4
-- Altera type para 'calculado' para que a formula seja usada.
-- Mantém is_summary = true para que a UI mostre expand/collapse.

UPDATE public.dre_accounts
SET
  type = 'calculado',
  formula = '5.1+5.2+5.3+5.4+5.5+5.6+5.7+5.8+5.9+5.10-2.4'
WHERE code = '5';
