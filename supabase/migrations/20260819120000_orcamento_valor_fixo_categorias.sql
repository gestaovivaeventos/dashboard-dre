-- =============================================================================
-- Módulo Orçamento — despesas por VALOR FIXO com correção de índices.
--
-- Para cada empresa/ano, as categorias marcadas com o método 'valor_fixo' na
-- tela "Método de orçamento por categoria" são orçadas a partir de um VALOR
-- BASE informado pelo usuário (ex.: o aluguel atual), corrigido por um índice
-- (IGP-M, IPCA, …) do ano — e o reajuste passa a valer a partir de um MÊS
-- escolhido. Ex.: aluguel 1.000 + IGP-M 4,08% com reajuste em julho →
-- jan–jun 1.000/mês, jul–dez 1.048/mês.
--
-- Difere da MÉDIA: lá o valor vem do realizado do ano anterior (Omie); aqui o
-- valor base é DIGITADO pelo usuário. Tudo o mais (correção por índice do ano,
-- snapshot versionado por ano, chave = código da categoria) segue o mesmo
-- desenho de orcamento_media_categorias.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.orcamento_valor_fixo_categorias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  category_code text NOT NULL,
  category_name text,
  -- Valor base informado pelo usuário (ex.: o custo atual). NULL = ainda não preenchido.
  valor_base numeric CHECK (valor_base IS NULL OR valor_base >= 0),
  -- Índice de correção escolhido (chave do catálogo INDICES). NULL = sem correção.
  indice_key text,
  -- Mês em que o reajuste passa a valer (1..12). NULL = sem reajuste no ano
  -- (o valor base vale os 12 meses).
  mes_reajuste integer CHECK (mes_reajuste IS NULL OR (mes_reajuste BETWEEN 1 AND 12)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (company_id, year, category_code)
);

CREATE INDEX IF NOT EXISTS orcamento_valor_fixo_categorias_company_year_idx
  ON public.orcamento_valor_fixo_categorias (company_id, year);

DROP TRIGGER IF EXISTS orcamento_valor_fixo_categorias_touch_updated_at_trg ON public.orcamento_valor_fixo_categorias;
CREATE TRIGGER orcamento_valor_fixo_categorias_touch_updated_at_trg
BEFORE UPDATE ON public.orcamento_valor_fixo_categorias
FOR EACH ROW EXECUTE FUNCTION public.orcamento_touch_updated_at();

-- ─── RLS — admin-only, como o resto do módulo ───────────────────────────────
ALTER TABLE public.orcamento_valor_fixo_categorias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orcamento_valor_fixo_categorias admin all" ON public.orcamento_valor_fixo_categorias;
CREATE POLICY "orcamento_valor_fixo_categorias admin all"
ON public.orcamento_valor_fixo_categorias
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());
