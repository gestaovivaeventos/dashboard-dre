-- Saldo anterior ao Omie — corrige a âncora da Viva Petrópolis para JANEIRO/2022.
--
-- Ontem o ajuste manual entrou em nov/2022, mas a âncora correta é jan/2022 (corte
-- da migração do sistema Mundo Viva para a Omie — mesmo mês para todas as empresas,
-- agora editável em Configurações › "Saldo anterior ao Omie"). Move o valor
-- (R$ 12.980,37) de 2022/11 para 2022/1. Idempotente.

delete from public.cash_flow_opening_balances
  where company_id = '67a5da5b-1f51-4519-8e5a-710e54560b95'
    and period_year = 2022 and period_month = 11;

insert into public.cash_flow_opening_balances (company_id, period_year, period_month, amount, notes)
values ('67a5da5b-1f51-4519-8e5a-710e54560b95', 2022, 1, 12980.37,
        'Saldo anterior ao Omie — Viva Petrópolis, jan/2022 (corte Mundo Viva → Omie).')
on conflict (company_id, period_year, period_month)
do update set amount = excluded.amount, notes = excluded.notes, updated_at = now();
