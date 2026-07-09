-- Tipo da chave PIX (cpf_cnpj | telefone | email | aleatoria) do cadastro do
-- fornecedor/atração — só para a UI validar/formatar; o Omie guarda só a chave.
ALTER TABLE public.case_bands
  ADD COLUMN chave_pix_tipo text;
