-- Uma linha pode ter só a categoria "sem nota fiscal" (codigo_categoria_sem_nota)
-- sem a "com nota fiscal" (codigo_categoria). Torna codigo_categoria nullable
-- para o upsert por coluna não violar NOT NULL.
ALTER TABLE ctrl_expense_type_omie_categoria
  ALTER COLUMN codigo_categoria DROP NOT NULL;
