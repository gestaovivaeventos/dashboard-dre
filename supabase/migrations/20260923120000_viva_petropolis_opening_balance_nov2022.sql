-- Saldo inicial de caixa (Fluxo de Caixa) — Viva Petrópolis, nov/2022.
--
-- Ajuste manual pedido pela Controladoria: ancora o "Saldo Inicial" da empresa
-- em nov/2022 (mês do primeiro lançamento na base) em R$ 12.980,37. A partir daí
-- os meses seguintes encadeiam sozinhos (Saldo Inicial do mês = Caixa Final do
-- mês anterior). Ver cash_flow_opening_balances em 20260506140000_cash_flow_module.sql
-- e a leitura em src/app/(app)/fluxo-de-caixa/page.tsx.
--
-- Idempotente: reexecutar apenas atualiza o valor (chave única
-- company_id + period_year + period_month).

INSERT INTO public.cash_flow_opening_balances
  (company_id, period_year, period_month, amount, notes)
VALUES
  ('67a5da5b-1f51-4519-8e5a-710e54560b95', 2022, 11, 12980.37,
   'Saldo inicial de caixa — Viva Petrópolis, nov/2022 (ajuste manual da Controladoria).')
ON CONFLICT (company_id, period_year, period_month)
DO UPDATE SET amount = EXCLUDED.amount, notes = EXCLUDED.notes, updated_at = now();
