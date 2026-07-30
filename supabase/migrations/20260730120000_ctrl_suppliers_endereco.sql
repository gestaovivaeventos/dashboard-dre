-- Endereço do fornecedor brasileiro (obrigatório para o cadastro na Omie).
--
-- As colunas endereco/endereco_numero/complemento/cidade/estado já existiam,
-- mas eram preenchidas SÓ para fornecedor estrangeiro (migration
-- 20260714120000). A partir daqui elas valem também para o fluxo brasileiro —
-- a Omie exige endereço completo no cadastro de cliente/fornecedor e monta o
-- endereço a partir do CEP + número.
--
-- Faltavam duas colunas para fechar o endereço nacional:
--   cep    — CEP formatado "00000-000" (enviado à Omie no campo `cep`)
--   bairro — bairro (campo `bairro` da Omie), vem do CEP
--
-- Continuam opcionais no banco: os cadastros antigos ficaram sem endereço e a
-- obrigatoriedade é validada na aplicação (novo cadastro exige; edição só
-- exige quando o endereço já existe ou o usuário começa a preenchê-lo).

ALTER TABLE public.ctrl_suppliers
  ADD COLUMN IF NOT EXISTS cep    TEXT,
  ADD COLUMN IF NOT EXISTS bairro TEXT;

COMMENT ON COLUMN public.ctrl_suppliers.cep IS
  'CEP do fornecedor no formato 00000-000. Enviado à Omie como `cep`.';
COMMENT ON COLUMN public.ctrl_suppliers.bairro IS
  'Bairro do endereço (preenchido pela busca de CEP). Enviado à Omie como `bairro`.';
COMMENT ON COLUMN public.ctrl_suppliers.estado IS
  'UF do endereço (ex.: "MG"). Para fornecedor estrangeiro é sempre "EX".';
