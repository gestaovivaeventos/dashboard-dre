-- =============================================================================
-- Módulo Orçamento — Despesas com pessoal, ETAPA 2 (benefícios, "parte verde").
--
-- Benefícios são valores MENSAIS POR COLABORADOR, na mesma linha do quadro
-- (mesma pessoa da etapa azul). O admin preenche por colaborador e o gestor
-- pode alterar — não há tabela de padrão global. Colunas anuláveis (colaborador
-- pode não ter um benefício). Todas em reais, mensais.
--
-- Ficam como colunas na própria orcamento_pessoal_colaboradores para grudar o
-- benefício na pessoa. Idempotente (ADD COLUMN IF NOT EXISTS).
-- =============================================================================

ALTER TABLE public.orcamento_pessoal_colaboradores
  ADD COLUMN IF NOT EXISTS vale_transporte numeric
    CHECK (vale_transporte IS NULL OR vale_transporte >= 0),
  ADD COLUMN IF NOT EXISTS beneficio_gasolina numeric
    CHECK (beneficio_gasolina IS NULL OR beneficio_gasolina >= 0),
  ADD COLUMN IF NOT EXISTS beneficio_alimentacao numeric
    CHECK (beneficio_alimentacao IS NULL OR beneficio_alimentacao >= 0),
  ADD COLUMN IF NOT EXISTS assistencia_medica numeric
    CHECK (assistencia_medica IS NULL OR assistencia_medica >= 0),
  ADD COLUMN IF NOT EXISTS auxilio_home_office numeric
    CHECK (auxilio_home_office IS NULL OR auxilio_home_office >= 0);
