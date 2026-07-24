-- Nome fantasia do fornecedor.
--
-- A Omie tem os campos razao_social (nome oficial) e nome_fantasia (nome de
-- exibição/marca). Até aqui o cadastro guardava só o nome (razão social) e o
-- payload Omie reaproveitava esse nome como nome_fantasia. Agora o usuário pode
-- informar o nome fantasia separadamente na tela de cadastro; quando vazio, o
-- buildClientePayload continua caindo no fallback (razão social).
--
-- Coluna opcional (não afeta o fluxo existente).

ALTER TABLE public.ctrl_suppliers
  ADD COLUMN IF NOT EXISTS nome_fantasia TEXT;

COMMENT ON COLUMN public.ctrl_suppliers.nome_fantasia IS
  'Nome fantasia do fornecedor, enviado à Omie como nome_fantasia. Quando vazio, a Omie recebe a razão social (name) no lugar.';
