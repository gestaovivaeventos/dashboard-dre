-- =============================================================================
-- category_mapping: permite dre_account_id NULL como "tombstone"
-- =============================================================================
-- Cenario: empresas com plano DRE custom (ex.: SGX) podem precisar
-- EXPLICITAMENTE desvincular uma categoria Omie que tem mapeamento global.
-- Antes desta mudanca, "Salvar" com dropdown vazio so deletava a linha
-- com company_id = X — a linha global (company_id IS NULL) continuava
-- valendo, e ao recarregar a tela o mapeamento global ressurgia.
--
-- Pior ainda quando o code do plano global coincide com um code do plano
-- custom: a UI traduz por code (translateToScopedId) e mostra o NOME da
-- conta custom da empresa, mascarando o problema. Ex.: global 1.3
-- ("Clientes - Servicos Prestados - Cerimonial/Fee") era exibido na SGX
-- como "1.3 - PREDIO SAO PEDRO" porque a SGX tem uma conta 1.3 com
-- esse nome no plano custom.
--
-- Solucao: permitir dre_account_id NULL. Uma linha company-scoped com
-- dre_account_id NULL atua como "tombstone" — sobrescreve o mapeamento
-- global e efetivamente desmapeia a categoria para aquela empresa.
--
-- A RPC dashboard_dre_aggregate ja lida bem com NULL: a LATERAL prefere
-- a linha company-scoped (mesmo com NULL), e o NULL final cai fora do
-- agrupamento por dre_account_id no dashboard.
-- =============================================================================

ALTER TABLE public.category_mapping
  ALTER COLUMN dre_account_id DROP NOT NULL;
