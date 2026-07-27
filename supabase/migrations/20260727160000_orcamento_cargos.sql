-- =============================================================================
-- Módulo Orçamento — Plano de Cargos e Salários, POR EMPRESA.
--
-- Cada empresa tem seu próprio plano. Um cargo tem vários NÍVEIS (ex.: Júnior,
-- Pleno, Sênior, ou I/II/III), cada nível com seu salário. O quadro de
-- funcionários (tela futura de Despesas com pessoal) vai referenciar o nível
-- de cargo como salário-base, permanecendo editável por pessoa.
-- =============================================================================

-- ─── Cargos por empresa ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.orcamento_cargos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS orcamento_cargos_company_name_lower_idx
  ON public.orcamento_cargos (company_id, lower(name));

CREATE INDEX IF NOT EXISTS orcamento_cargos_company_idx
  ON public.orcamento_cargos (company_id, active);

DROP TRIGGER IF EXISTS orcamento_cargos_touch_updated_at_trg ON public.orcamento_cargos;
CREATE TRIGGER orcamento_cargos_touch_updated_at_trg
BEFORE UPDATE ON public.orcamento_cargos
FOR EACH ROW EXECUTE FUNCTION public.orcamento_touch_updated_at();

-- ─── Níveis de cada cargo ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.orcamento_cargo_niveis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cargo_id uuid NOT NULL REFERENCES public.orcamento_cargos(id) ON DELETE CASCADE,
  name text NOT NULL,
  salario numeric NOT NULL CHECK (salario >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

-- Nome de nível único por cargo (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS orcamento_cargo_niveis_cargo_name_lower_idx
  ON public.orcamento_cargo_niveis (cargo_id, lower(name));

CREATE INDEX IF NOT EXISTS orcamento_cargo_niveis_cargo_idx
  ON public.orcamento_cargo_niveis (cargo_id);

DROP TRIGGER IF EXISTS orcamento_cargo_niveis_touch_updated_at_trg ON public.orcamento_cargo_niveis;
CREATE TRIGGER orcamento_cargo_niveis_touch_updated_at_trg
BEFORE UPDATE ON public.orcamento_cargo_niveis
FOR EACH ROW EXECUTE FUNCTION public.orcamento_touch_updated_at();

-- ─── RLS — admin-only, como o resto do módulo ───────────────────────────────
ALTER TABLE public.orcamento_cargos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orcamento_cargo_niveis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orcamento_cargos admin all"
ON public.orcamento_cargos
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "orcamento_cargo_niveis admin all"
ON public.orcamento_cargo_niveis
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());
