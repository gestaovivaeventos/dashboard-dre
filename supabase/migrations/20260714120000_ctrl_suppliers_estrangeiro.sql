-- Fornecedor estrangeiro (sem CNPJ/CPF brasileiro).
--
-- A Omie representa clientes/fornecedores do exterior com estado "EX"
-- (Exterior) + codigo_pais (tabela BACEN, ex.: Estados Unidos = 2496) e o
-- campo CNPJ/CPF fica em branco (a interface mostra "Estrangeiro"). Guardamos
-- aqui os dados de endereço internacional para montar esse cadastro.
--
-- Todas as colunas são opcionais no banco; a obrigatoriedade de País/Estado
-- para fornecedores estrangeiros é validada na aplicação (o fluxo brasileiro
-- segue exigindo CNPJ/CPF e não é afetado por estas colunas).

ALTER TABLE public.ctrl_suppliers
  ADD COLUMN IF NOT EXISTS estrangeiro      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pais             TEXT,   -- nome do país (ex.: "Estados Unidos")
  ADD COLUMN IF NOT EXISTS codigo_pais      TEXT,   -- código BACEN (ex.: "2496")
  ADD COLUMN IF NOT EXISTS estado           TEXT,   -- "EX" para estrangeiros
  ADD COLUMN IF NOT EXISTS cidade           TEXT,
  ADD COLUMN IF NOT EXISTS endereco         TEXT,
  ADD COLUMN IF NOT EXISTS endereco_numero  TEXT,
  ADD COLUMN IF NOT EXISTS complemento      TEXT;

COMMENT ON COLUMN public.ctrl_suppliers.estrangeiro IS
  'Fornecedor do exterior sem CNPJ/CPF brasileiro. No Omie vira estado=EX + codigo_pais.';
COMMENT ON COLUMN public.ctrl_suppliers.codigo_pais IS
  'Código BACEN do país (tabela cPais NF-e), enviado à Omie como codigo_pais.';
