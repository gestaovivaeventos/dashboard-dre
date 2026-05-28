-- =============================================================================
-- Adiciona campo `margem_media_eventos` em `companies` para empresas do
-- segmento Franquias Viva. E um valor manual por empresa, alimentado via
-- painel FEE / VVR em Configuracoes > Empresas, e exibido como indicador
-- adicional na tela de Business Intelligence.
--
-- Como `fee_disponivel` e `fee_a_receber`, este campo nao afeta DRE, KPIs
-- ou Fluxo de Caixa — apenas armazenamento simples por empresa. Ele e
-- preenchido apenas para empresas do segmento Franquias Viva, mas a coluna
-- existe globalmente (NULL nas demais).
-- =============================================================================

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS margem_media_eventos numeric;
