-- Categoria definida no ENVIO (Contas a Pagar) para tipos de despesa "grupo"
-- (ex.: Investimentos), que no Omie são um grupo com VÁRIAS categorias e por
-- isso não têm um mapeamento tipo → categoria único.
--
-- - ctrl_expense_types.categoria_no_envio: marca o tipo como "a categoria é
--   escolhida no envio". É uma propriedade do TIPO (vale para todas as empresas).
--   Quando ligado, o tipo dispensa o mapeamento tipo → categoria e o operador do
--   Contas a Pagar escolhe a categoria Omie na hora de enviar para pagamento.
-- - ctrl_requests.omie_categoria_override: a categoria Omie escolhida pelo
--   operador, gravada ANTES de enfileirar. O lançamento (launchRequestToOmie) a
--   usa com PRECEDÊNCIA sobre o mapeamento. Nulo = usa o mapeamento normal.

ALTER TABLE public.ctrl_expense_types
  ADD COLUMN IF NOT EXISTS categoria_no_envio boolean NOT NULL DEFAULT false;

ALTER TABLE public.ctrl_requests
  ADD COLUMN IF NOT EXISTS omie_categoria_override text;
