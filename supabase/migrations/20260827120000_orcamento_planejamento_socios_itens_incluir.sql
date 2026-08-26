-- =============================================================================
-- Planejamento dos sócios (27/08/2026): a curadoria e a edição foram FUNDIDAS na
-- tabela de itens. Cada fornecedor do ano anterior vira uma LINHA de item, com um
-- checkbox `incluir` (marca = entra no orçamento e na entrevista da IA). Os itens
-- excluídos ficam gravados com incluir=false para NÃO voltarem a ser sugeridos.
--
-- A coluna `curadoria` (jsonb) na tabela da categoria fica órfã (o incluir/nome
-- passaram para a própria linha do item) — mantida só para não fazer DROP
-- destrutivo; nada mais a lê/escreve.
-- =============================================================================

ALTER TABLE public.orcamento_planejamento_socios_itens
  ADD COLUMN IF NOT EXISTS incluir boolean NOT NULL DEFAULT true;

NOTIFY pgrst, 'reload schema';
