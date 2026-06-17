-- Categoria Omie por tipo de despesa agora depende de ter ou não nota fiscal.
-- codigo_categoria = "com nota fiscal" (sim / sim_apos_pagamento);
-- codigo_categoria_sem_nota = "sem nota fiscal" (nao).
ALTER TABLE ctrl_expense_type_omie_categoria
  ADD COLUMN IF NOT EXISTS codigo_categoria_sem_nota text;
