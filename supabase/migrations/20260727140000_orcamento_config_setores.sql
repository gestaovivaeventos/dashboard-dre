-- =============================================================================
-- Módulo Orçamento — configuração por empresa.
--
-- Cada empresa tem sua PRÓPRIA configuração de construção do orçamento. Este
-- primeiro bloco cobre duas telas de Configurações (ambas admin-only):
--   1. "Orçar por setor" → toggle por empresa (orcamento_company_config).
--   2. "Setores"         → lista de setores por empresa (orcamento_setores).
--
-- O "setor" do orçamento é uma dimensão própria do módulo, SEM relação com o
-- "departamento" da Omie. Setor só é usado quando a empresa está com
-- orcar_por_setor = true; caso contrário o orçamento é detalhado só por
-- categoria.
-- =============================================================================

-- updated_at automático, compartilhado pelas tabelas do módulo Orçamento.
CREATE OR REPLACE FUNCTION public.orcamento_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ─── Configuração de orçamento por empresa ──────────────────────────────────
-- Uma linha por empresa (company_id é PK). Cresce com novas preferências de
-- orçamento no futuro; por ora guarda apenas o toggle "orçar por setor".
CREATE TABLE IF NOT EXISTS public.orcamento_company_config (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  orcar_por_setor boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

DROP TRIGGER IF EXISTS orcamento_company_config_touch_updated_at_trg ON public.orcamento_company_config;
CREATE TRIGGER orcamento_company_config_touch_updated_at_trg
BEFORE UPDATE ON public.orcamento_company_config
FOR EACH ROW EXECUTE FUNCTION public.orcamento_touch_updated_at();

-- ─── Setores do orçamento por empresa ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.orcamento_setores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

-- Nome único por empresa (case-insensitive), considerando ativos e inativos.
CREATE UNIQUE INDEX IF NOT EXISTS orcamento_setores_company_name_lower_idx
  ON public.orcamento_setores (company_id, lower(name));

CREATE INDEX IF NOT EXISTS orcamento_setores_company_idx
  ON public.orcamento_setores (company_id, active);

DROP TRIGGER IF EXISTS orcamento_setores_touch_updated_at_trg ON public.orcamento_setores;
CREATE TRIGGER orcamento_setores_touch_updated_at_trg
BEFORE UPDATE ON public.orcamento_setores
FOR EACH ROW EXECUTE FUNCTION public.orcamento_touch_updated_at();

-- ─── RLS — módulo é admin-only em todas as telas ────────────────────────────
ALTER TABLE public.orcamento_company_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orcamento_setores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orcamento_company_config admin all"
ON public.orcamento_company_config
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "orcamento_setores admin all"
ON public.orcamento_setores
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());
