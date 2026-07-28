-- =============================================================================
-- Módulo Orçamento — vínculo CATEGORIA → MÉTODO de orçamento, POR EMPRESA.
--
-- Define, para cada empresa, por qual método cada categoria de despesa é
-- orçada. A MESMA categoria pode ter métodos diferentes em empresas diferentes
-- (ex.: "Energia" via média na empresa X e via planejamento dos sócios na Y).
--
-- A lista de categorias vem do mapeamento existente (category_mapping), filtrada
-- às categorias cuja linha DRE é de despesa. Aqui guardamos só o vínculo com o
-- método; a ausência de linha = categoria não orçada por esses produtores.
--
-- Chave da categoria: o código da categoria Omie (category_mapping.
-- omie_category_code). Guardamos o nome como snapshot para exibição estável.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.orcamento_categoria_metodo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  category_code text NOT NULL,
  category_name text,
  metodo text NOT NULL CHECK (
    metodo IN (
      'pessoal',
      'media',
      'valor_fixo',
      'planejamento_socios',
      'viagens_ve',
      'marketing_ve',
      'endomarketing_ve'
    )
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (company_id, category_code)
);

CREATE INDEX IF NOT EXISTS orcamento_categoria_metodo_company_idx
  ON public.orcamento_categoria_metodo (company_id);

DROP TRIGGER IF EXISTS orcamento_categoria_metodo_touch_updated_at_trg ON public.orcamento_categoria_metodo;
CREATE TRIGGER orcamento_categoria_metodo_touch_updated_at_trg
BEFORE UPDATE ON public.orcamento_categoria_metodo
FOR EACH ROW EXECUTE FUNCTION public.orcamento_touch_updated_at();

-- ─── RLS — admin-only, como o resto do módulo ───────────────────────────────
ALTER TABLE public.orcamento_categoria_metodo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orcamento_categoria_metodo admin all"
ON public.orcamento_categoria_metodo
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());
