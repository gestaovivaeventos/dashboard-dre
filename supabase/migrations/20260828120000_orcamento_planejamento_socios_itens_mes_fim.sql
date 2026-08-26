-- Planejamento dos sócios: mês do ÚLTIMO pagamento (cancelamento no meio do ano).
-- Item mensal cancelado em julho (último pago em junho) -> mes_fim = 6, conta jan..jun.
-- NULL = vai até dezembro. Ignorado quando periodicidade = 'anual'.
ALTER TABLE public.orcamento_planejamento_socios_itens
  ADD COLUMN IF NOT EXISTS mes_fim integer;

ALTER TABLE public.orcamento_planejamento_socios_itens
  DROP CONSTRAINT IF EXISTS orcamento_planejamento_socios_itens_mes_fim_check;

ALTER TABLE public.orcamento_planejamento_socios_itens
  ADD CONSTRAINT orcamento_planejamento_socios_itens_mes_fim_check
  CHECK (mes_fim IS NULL OR (mes_fim >= 1 AND mes_fim <= 12));

NOTIFY pgrst, 'reload schema';
