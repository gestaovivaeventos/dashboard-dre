-- =============================================================================
-- Módulo Orçamento — agrupar ou separar cada benefício na prévia.
--
-- Por padrão todos os benefícios entram somados na linha "Benefícios" da prévia
-- (e numa única linha do orçamento). Algumas empresas precisam de benefícios em
-- contas separadas da DRE — assistência médica numa conta, vale transporte em
-- outra. Este flag, por empresa × ano × benefício, decide:
--
--   agrupar = true  (padrão) → soma na linha "Benefícios"
--   agrupar = false          → vira uma LINHA PRÓPRIA na prévia e, no envio ao
--                              Budget e Forecast, um rótulo próprio
--                              ("Pessoal — Vale transporte") a ser mapeado a
--                              uma conta da DRE.
--
-- Sem linha na tabela = agrupado, que é o comportamento que já existia. Só as
-- exceções são gravadas.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.orcamento_beneficios_config (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  -- Chave do benefício, igual à coluna correspondente em
  -- orcamento_pessoal_colaboradores (vale_transporte, assistencia_medica, ...).
  beneficio text NOT NULL,
  agrupar boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,

  PRIMARY KEY (company_id, year, beneficio)
);

DROP TRIGGER IF EXISTS orcamento_beneficios_config_touch_updated_at_trg
  ON public.orcamento_beneficios_config;
CREATE TRIGGER orcamento_beneficios_config_touch_updated_at_trg
BEFORE UPDATE ON public.orcamento_beneficios_config
FOR EACH ROW EXECUTE FUNCTION public.orcamento_touch_updated_at();

-- ─── RLS — admin-only, como o resto do módulo ───────────────────────────────
ALTER TABLE public.orcamento_beneficios_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orcamento_beneficios_config admin all"
  ON public.orcamento_beneficios_config;
CREATE POLICY "orcamento_beneficios_config admin all"
ON public.orcamento_beneficios_config
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());
