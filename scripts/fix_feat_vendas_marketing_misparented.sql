-- Fix: Feat Producoes — grupo "Vendas e Marketing" (7.1) com filhos errados
--
-- CONTEXTO
-- O plano DRE custom da Feat Producoes (company_id = 70569e20-bc07-445c-96ea-8911441ae471)
-- tinha 18 contas filhas sob "7.1 Vendas e Marketing", quando o correto (igual ao
-- plano global e demais empresas) sao apenas as contas de vendas/marketing.
-- As linhas 7.1.5 a 7.1.18 eram contas administrativas (Telefonia, IPTU, Advogados,
-- Contabilidade, etc.) mal-parenteadas sob 7.1 — duplicatas das contas que JA existem
-- corretamente sob "7.3 Administrativas". Todas SEM mapeamento Omie e com valor zero.
--
-- O dashboard DRE e a tela de Estrutura DRE leem a hierarquia por parent_id (correto);
-- o problema era puramente de dados nesta empresa. Esta correcao NAO altera nenhuma
-- regra de calculo, mapeamento, projeto, departamento ou categoria — apenas remove
-- as 14 contas vazias mal-parenteadas.
--
-- Mantidas sob 7.1 (possuem mapeamento Omie e valores reais):
--   7.1.1 Marketing, 7.1.2 Captacao de Clientes,
--   7.1.3 Comissoes Comercial, 7.1.4 Patrocinio
--
-- Removidas (sem mapeamento, valor zero, duplicatas de 7.3 Administrativas):
--   7.1.5 .. 7.1.18
--
-- Seguranca verificada antes de aplicar: 0 filhos, 0 category_mapping,
-- 0 referencias em formulas de contas calculadas.

DELETE FROM public.dre_accounts
WHERE company_id = '70569e20-bc07-445c-96ea-8911441ae471'
  AND code IN (
    '7.1.5','7.1.6','7.1.7','7.1.8','7.1.9','7.1.10',
    '7.1.11','7.1.12','7.1.13','7.1.14','7.1.15','7.1.16','7.1.17','7.1.18'
  )
  -- guardas extras de seguranca: so folhas, sem mapeamento
  AND id NOT IN (SELECT parent_id FROM public.dre_accounts WHERE parent_id IS NOT NULL)
  AND id NOT IN (SELECT dre_account_id FROM public.category_mapping WHERE dre_account_id IS NOT NULL);
