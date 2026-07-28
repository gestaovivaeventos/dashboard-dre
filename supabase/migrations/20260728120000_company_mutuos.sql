-- =============================================================================
-- Mutuos por unidade — segmento Franquias Viva.
-- -----------------------------------------------------------------------------
-- Cada unidade Viva tem UMA situacao de mutuo (contrato de emprestimo com o
-- grupo), preenchida MANUALMENTE pelo administrador no painel "Mutuos" em
-- Configuracoes > Empresas (mesmo padrao arquitetural do painel FEE / VVR):
--
--   mutuo_principal      → valor do principal contratado
--   mutuo_amortizado     → valor ja amortizado
--   mutuo_saldo_devedor  → saldo devedor em aberto
--
-- Regra de negocio: saldo devedor nulo ou zero significa "sem mutuo em aberto"
-- — nesse caso a unidade NAO aparece no quadro de mutuos do relatorio de
-- Business Intelligence (aplicado na camada de aplicacao).
--
-- Como fee_disponivel / fee_a_receber / margem_media_eventos / inadimplencia_atual,
-- sao campos de REGISTRO: nao afetam DRE, KPIs, Fluxo de Caixa nem Orcamento.
-- As colunas existem globalmente (NULL nas empresas de outros segmentos); apenas
-- o segmento franquias-viva recebe a interface para grava-las.
-- =============================================================================

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS mutuo_principal numeric,
  ADD COLUMN IF NOT EXISTS mutuo_amortizado numeric,
  ADD COLUMN IF NOT EXISTS mutuo_saldo_devedor numeric;
