-- Nome da atração (nome artístico) separado da razão social do cadastro.
-- A razão social continua sendo o que vai ao Omie e ao contrato; o nome
-- artístico é o que aparece na agenda e nas listas.
ALTER TABLE public.case_bands
  ADD COLUMN IF NOT EXISTS nome_artistico text;
