-- =============================================================================
-- Módulo Orçamento — VERSIONAMENTO POR ANO das configurações.
--
-- O orçamento é anual e todas as premissas de configuração (setores, cargos e
-- salários, método por categoria e o toggle "orçar por setor") são revisadas a
-- cada ano. Para que o orçamento de um ano NUNCA mude quando o ano seguinte é
-- montado, cada tabela de config ganha a coluna `year` (o ano do orçamento) e
-- as chaves de unicidade passam a incluir o ano.
--
-- Os índices de correção (orcamento_indices) já são por ano (ano-base) e não
-- são tocados aqui.
--
-- BACKFILL: as linhas de config que já existem foram criadas para o orçamento
-- que está sendo montado agora (2027) → recebem year = 2027. Depois removemos o
-- DEFAULT para que toda inserção futura precise informar o ano explicitamente.
--
-- Idempotência: ADD COLUMN IF NOT EXISTS + drop de PK/UNIQUE antigos por
-- DESCOBERTA (pg_constraint), não por nome fixo — assim reaplicar é seguro e
-- não sobra uma constraint antiga sem o ano (que quebraria o multi-ano).
-- =============================================================================

-- ─── orcamento_company_config (era PK = company_id) ─────────────────────────
ALTER TABLE public.orcamento_company_config
  ADD COLUMN IF NOT EXISTS year integer NOT NULL DEFAULT 2027;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.orcamento_company_config'::regclass AND contype = 'p'
  LOOP
    EXECUTE format('ALTER TABLE public.orcamento_company_config DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.orcamento_company_config
  ADD CONSTRAINT orcamento_company_config_pkey PRIMARY KEY (company_id, year);

ALTER TABLE public.orcamento_company_config ALTER COLUMN year DROP DEFAULT;

-- ─── orcamento_setores (unique era (company_id, lower(name))) ───────────────
ALTER TABLE public.orcamento_setores
  ADD COLUMN IF NOT EXISTS year integer NOT NULL DEFAULT 2027;

DROP INDEX IF EXISTS public.orcamento_setores_company_name_lower_idx;
DROP INDEX IF EXISTS public.orcamento_setores_company_idx;

CREATE UNIQUE INDEX IF NOT EXISTS orcamento_setores_company_year_name_lower_idx
  ON public.orcamento_setores (company_id, year, lower(name));
CREATE INDEX IF NOT EXISTS orcamento_setores_company_year_idx
  ON public.orcamento_setores (company_id, year, active);

ALTER TABLE public.orcamento_setores ALTER COLUMN year DROP DEFAULT;

-- ─── orcamento_cargos (unique era (company_id, lower(name))) ────────────────
-- Níveis (orcamento_cargo_niveis) pertencem a um cargo, que já é por ano →
-- não precisam de coluna própria de ano.
ALTER TABLE public.orcamento_cargos
  ADD COLUMN IF NOT EXISTS year integer NOT NULL DEFAULT 2027;

DROP INDEX IF EXISTS public.orcamento_cargos_company_name_lower_idx;
DROP INDEX IF EXISTS public.orcamento_cargos_company_idx;

CREATE UNIQUE INDEX IF NOT EXISTS orcamento_cargos_company_year_name_lower_idx
  ON public.orcamento_cargos (company_id, year, lower(name));
CREATE INDEX IF NOT EXISTS orcamento_cargos_company_year_idx
  ON public.orcamento_cargos (company_id, year, active);

ALTER TABLE public.orcamento_cargos ALTER COLUMN year DROP DEFAULT;

-- ─── orcamento_categoria_metodo (unique era (company_id, category_code)) ────
ALTER TABLE public.orcamento_categoria_metodo
  ADD COLUMN IF NOT EXISTS year integer NOT NULL DEFAULT 2027;

-- Remove QUALQUER unique antigo (por descoberta) para não coexistir com o novo.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.orcamento_categoria_metodo'::regclass AND contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE public.orcamento_categoria_metodo DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

DROP INDEX IF EXISTS public.orcamento_categoria_metodo_company_idx;

ALTER TABLE public.orcamento_categoria_metodo
  ADD CONSTRAINT orcamento_categoria_metodo_company_year_category_key
  UNIQUE (company_id, year, category_code);
CREATE INDEX IF NOT EXISTS orcamento_categoria_metodo_company_year_idx
  ON public.orcamento_categoria_metodo (company_id, year);

ALTER TABLE public.orcamento_categoria_metodo ALTER COLUMN year DROP DEFAULT;
