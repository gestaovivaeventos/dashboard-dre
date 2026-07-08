-- Despesas de comissão no contrato Case: mesmo mecanismo dos fornecedores da
-- verba Rider/Camarim, diferenciadas por tipo e lançadas em categorias próprias.
ALTER TABLE public.case_contract_fornecedores
  ADD COLUMN tipo text NOT NULL DEFAULT 'rider_camarim'
  CHECK (tipo IN ('rider_camarim', 'comissao_externa', 'comissao_rider'));

ALTER TABLE public.case_omie_config
  ADD COLUMN codigo_categoria_comissao_externa text,
  ADD COLUMN codigo_categoria_comissao_rider text;
