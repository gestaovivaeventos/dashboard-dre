-- =============================================================================
-- Módulo Orçamento — despesas por MÉDIA com correção de índices.
--
-- Para cada empresa/ano, as categorias marcadas com o método 'media' na tela
-- "Método de orçamento por categoria" são orçadas a partir da MÉDIA de consumo
-- realizada no ANO ANTERIOR (dados da Omie que alimentam a DRE Gerencial),
-- opcionalmente corrigida por um índice (IPCA, IGP-M, …) daquele ano.
--
-- A média é um SNAPSHOT versionado por ano: montado o orçamento de 2027, o valor
-- congela — reabrir 2028 não mexe em 2027. Por isso guardamos o valor efetivo da
-- média (não recalculamos ao vivo): o usuário atualiza pelo botão quando quiser
-- (ex.: em dezembro, com o ano-base já completo) e pode editar o valor à mão.
--
-- Chave da categoria: o código da categoria Omie (mesmo de category_mapping /
-- orcamento_categoria_metodo). category_name é snapshot para exibição estável.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.orcamento_media_categorias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  category_code text NOT NULL,
  category_name text,
  -- Valor efetivo da média (snapshot). NULL = ainda não calculada/salva.
  media_valor numeric CHECK (media_valor IS NULL OR media_valor >= 0),
  -- true quando o usuário editou o valor à mão (≠ recalculado da Omie).
  manual boolean NOT NULL DEFAULT false,
  -- Índice de correção escolhido (chave do catálogo INDICES). NULL = sem correção.
  indice_key text,
  -- Rastros do último cálculo automático (para exibir na tela).
  base_year integer,
  meses_considerados integer,
  calculado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (company_id, year, category_code)
);

CREATE INDEX IF NOT EXISTS orcamento_media_categorias_company_year_idx
  ON public.orcamento_media_categorias (company_id, year);

DROP TRIGGER IF EXISTS orcamento_media_categorias_touch_updated_at_trg ON public.orcamento_media_categorias;
CREATE TRIGGER orcamento_media_categorias_touch_updated_at_trg
BEFORE UPDATE ON public.orcamento_media_categorias
FOR EACH ROW EXECUTE FUNCTION public.orcamento_touch_updated_at();

-- ─── RLS — admin-only, como o resto do módulo ───────────────────────────────
ALTER TABLE public.orcamento_media_categorias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orcamento_media_categorias admin all"
ON public.orcamento_media_categorias
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- =============================================================================
-- Realizado por categoria × mês do ANO-BASE, agregado no servidor.
--
-- financial_entries é a fonte de caixa que alimenta a DRE Gerencial. Uma empresa
-- num ano passa facilmente das 1000 linhas do teto do PostgREST, então a soma
-- por (categoria, mês) tem de ser feita aqui — um SELECT cru truncaria e daria
-- média errada. SECURITY DEFINER para somar sem esbarrar na RLS de
-- financial_entries; o acesso é protegido na server action (admin-only).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.orcamento_media_realizado(
  p_company_id uuid,
  p_base_year integer,
  p_category_codes text[]
)
RETURNS TABLE (category_code text, month integer, total numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    fe.category_code,
    EXTRACT(MONTH FROM fe.payment_date)::int AS month,
    sum(fe.value)::numeric AS total
  FROM public.financial_entries fe
  WHERE fe.company_id = p_company_id
    AND fe.type = 'despesa'
    AND fe.category_code = ANY (p_category_codes)
    AND EXTRACT(YEAR FROM fe.payment_date) = p_base_year
  GROUP BY fe.category_code, EXTRACT(MONTH FROM fe.payment_date);
$$;

GRANT EXECUTE ON FUNCTION public.orcamento_media_realizado(uuid, integer, text[]) TO authenticated;
