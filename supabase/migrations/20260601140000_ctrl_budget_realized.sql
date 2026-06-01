-- Realizado importado da planilha-base de orçamento (coluna "Valor Realizado").
-- Fica ao lado de `amount` (orçado). Na tela de orçamento, o realizado exibido é
-- a soma deste valor com as requisições aprovadas do ano.
ALTER TABLE public.ctrl_budget
  ADD COLUMN IF NOT EXISTS realized NUMERIC(15,2) NOT NULL DEFAULT 0;
