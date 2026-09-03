-- =============================================================================
-- Planejamento dos gestores — novas periodicidades de item.
--
-- O item de uma categoria era pago 'mensal' ou 'anual'. Passa a aceitar também
-- 'bimestral', 'trimestral' e 'semestral' — todas com a mesma semântica: o
-- primeiro pagamento cai em mes_inicio e os seguintes a cada N meses, até
-- mes_fim (ou dezembro). 'anual' segue sendo pagamento único no mês da
-- renovação, ignorando mes_fim.
--
-- Só troca o CHECK: os valores já gravados continuam válidos.
-- Idempotente (drop por nome + recriação).
-- =============================================================================

ALTER TABLE public.orcamento_planejamento_socios_itens
  DROP CONSTRAINT IF EXISTS orcamento_planejamento_socios_itens_periodicidade_chk;

ALTER TABLE public.orcamento_planejamento_socios_itens
  ADD CONSTRAINT orcamento_planejamento_socios_itens_periodicidade_chk
  CHECK (periodicidade IN ('mensal', 'bimestral', 'trimestral', 'semestral', 'anual'));
