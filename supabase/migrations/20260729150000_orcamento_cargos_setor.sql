-- =============================================================================
-- Módulo Orçamento — Plano de Cargos vinculado ao SETOR.
--
-- Quando a empresa orça por setor (config do ano), cada cargo passa a pertencer
-- a um setor. Isso direciona a lista suspensa de cargos na tela de Despesas com
-- pessoal: ao filtrar o setor X, só aparecem os cargos do setor X.
--
-- setor_id é ANULÁVEL: quando a empresa NÃO orça por setor, os cargos ficam com
-- setor_id NULL (plano único), como hoje.
--
-- Unicidade do nome do cargo: passa a considerar o setor. Uso coalesce(setor_id,
-- zero-uuid) para que dois setores possam ter um cargo de mesmo nome e, quando
-- setor_id é NULL, o nome continue único por (empresa, ano).
-- =============================================================================

ALTER TABLE public.orcamento_cargos
  ADD COLUMN IF NOT EXISTS setor_id uuid REFERENCES public.orcamento_setores(id) ON DELETE SET NULL;

-- Troca o unique (company_id, year, lower(name)) por um que inclui o setor.
DROP INDEX IF EXISTS public.orcamento_cargos_company_year_name_lower_idx;

CREATE UNIQUE INDEX IF NOT EXISTS orcamento_cargos_company_year_setor_name_lower_idx
  ON public.orcamento_cargos (
    company_id,
    year,
    coalesce(setor_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(name)
  );

CREATE INDEX IF NOT EXISTS orcamento_cargos_company_year_setor_idx
  ON public.orcamento_cargos (company_id, year, setor_id);
