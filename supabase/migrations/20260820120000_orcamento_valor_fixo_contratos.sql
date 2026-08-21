-- =============================================================================
-- Módulo Orçamento — VALOR FIXO: de 1 linha por categoria para N CONTRATOS.
--
-- Uma mesma categoria orçada por "valor fixo" pode reunir vários contratos
-- independentes (fornecedores, valores, índices e meses de reajuste diferentes).
-- Ex.: a categoria "Assessoria Administrativa" engloba os contratos de
-- "assessoria financeira" e "assessoria de atendimento" — cada um com seu valor
-- atual, índice e mês de reajuste. O orçado da categoria é a SOMA dos contratos
-- e, na Prévia, todos caem na mesma linha da DRE.
--
-- Por isso a tabela orcamento_valor_fixo_categorias deixa de ter no máximo uma
-- linha por (empresa, ano, categoria): a chave lógica do contrato passa a ser o
-- `id` (PK) que a tabela já tem. Adicionamos `descricao` para identificar cada
-- contrato quando há mais de um (a tela a exige a partir do 2º).
-- =============================================================================

-- Descrição do contrato (obrigatória na tela quando a categoria tem 2+ contratos;
-- opcional no schema para não travar o contrato único, que dispensa rótulo).
ALTER TABLE public.orcamento_valor_fixo_categorias
  ADD COLUMN IF NOT EXISTS descricao text
  CONSTRAINT orcamento_valor_fixo_categorias_descricao_len
    CHECK (descricao IS NULL OR char_length(descricao) <= 200);

-- Remove o UNIQUE (company_id, year, category_code): agora há N linhas por
-- categoria. O nome auto-gerado desse constraint passa de 63 chars e é truncado
-- pelo Postgres, então não confiamos no nome literal — dropamos qualquer
-- constraint UNIQUE ('u') que sobre na tabela (a PK é 'p' e não é afetada).
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.orcamento_valor_fixo_categorias'::regclass
      AND contype = 'u'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.orcamento_valor_fixo_categorias DROP CONSTRAINT %I',
      c.conname
    );
  END LOOP;
END $$;
