-- Contas a pagar do Case exigem categoria de DESPESA no Omie (a de custódia é
-- de receita e o Omie rejeita em contas a pagar).
ALTER TABLE public.case_omie_config
  ADD COLUMN codigo_categoria_pagar text;
