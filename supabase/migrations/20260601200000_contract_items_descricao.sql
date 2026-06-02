-- Descrição/título da requisição, importada da planilha de validação de
-- contratos. Usada pelo atalho FEE/Cerimonial: requisições cuja descrição
-- contém "fee" (palavra isolada) ou "cerimonial" vão direto para análise
-- especialista, sem leitura de documento.
ALTER TABLE public.contract_validation_items
  ADD COLUMN IF NOT EXISTS descricao text;
