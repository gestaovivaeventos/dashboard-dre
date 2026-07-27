-- =============================================================================
-- Módulo Orçamento — índices de correção por ano.
--
-- IPCA, IGP-M e salário mínimo são índices NACIONAIS: o valor é o mesmo para
-- todas as empresas, então esta tabela é GLOBAL (não por empresa). O que é por
-- empresa/despesa é a escolha de qual índice aplicar em cada linha — isso vive
-- nas telas de despesa.
--
-- Um registro por ANO (year é PK). Cada ano guarda seus próprios valores de
-- forma independente e imutável no tempo: cadastrar um ano novo NÃO altera os
-- anteriores. Isso é o que garante que o orçamento de 2026 não mude quando os
-- índices de 2027 forem cadastrados — as telas de despesa referenciam o índice
-- pelo ano específico do orçamento.
--
-- Valores: ipca/igpm em pontos percentuais (ex.: 4.5 = 4,5%); salario_minimo
-- em reais (ex.: 1518.00). Todos anuláveis — um ano pode ter só parte dos
-- índices conhecidos no momento do cadastro.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.orcamento_indices (
  year integer PRIMARY KEY CHECK (year BETWEEN 2000 AND 2100),
  ipca numeric,
  igpm numeric,
  salario_minimo numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

-- Reutiliza a função de touch criada na migration 20260727140000.
DROP TRIGGER IF EXISTS orcamento_indices_touch_updated_at_trg ON public.orcamento_indices;
CREATE TRIGGER orcamento_indices_touch_updated_at_trg
BEFORE UPDATE ON public.orcamento_indices
FOR EACH ROW EXECUTE FUNCTION public.orcamento_touch_updated_at();

-- ─── RLS — admin-only, como o resto do módulo ───────────────────────────────
ALTER TABLE public.orcamento_indices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orcamento_indices admin all"
ON public.orcamento_indices
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());
