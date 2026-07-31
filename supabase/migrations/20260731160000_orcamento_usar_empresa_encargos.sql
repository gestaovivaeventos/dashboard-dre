-- =============================================================================
-- Módulo Orçamento — habilitar a coluna "Empresa" no quadro de pessoal.
--
-- A coluna que define de qual empresa vem o REGIME TRIBUTÁRIO dos encargos de
-- cada colaborador só faz sentido em algumas empresas do grupo — naquelas em
-- que há gente registrada em outro CNPJ. Nas demais ela só polui um quadro que
-- já é largo.
--
-- Este toggle, por empresa × ano (como o orcar_por_setor, na mesma linha),
-- decide se a coluna aparece. Desligado (padrão) = coluna escondida E os
-- encargos de TODO o quadro seguem o regime da própria empresa orçada — a
-- configuração governa o comportamento, não só a exibição, para não existir
-- regra invisível mexendo em número de orçamento.
-- Idempotente (ADD COLUMN IF NOT EXISTS).
-- =============================================================================

ALTER TABLE public.orcamento_company_config
  ADD COLUMN IF NOT EXISTS usar_empresa_encargos boolean NOT NULL DEFAULT false;
