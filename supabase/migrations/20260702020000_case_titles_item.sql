-- Case: distingue o item de serviço (margem/rider/camarim/extras) dentro do leg
-- receber_servicos, para lançar cada serviço como título separado no Omie e
-- itemizar no contrato de venda. Nulo para pagar_custodia/receber_custodia.
ALTER TABLE public.case_titles ADD COLUMN IF NOT EXISTS title_item text;
