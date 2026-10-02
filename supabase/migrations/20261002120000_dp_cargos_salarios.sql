-- ============================================================================
-- Departamento Pessoal — estrutura de cargos e salários por empresa.
-- Depende de 20260929150000 (dp_has_access).
--
-- Decisão do dono do projeto (02/10/2026): cadastro PRÓPRIO do DP (não o Plano
-- de Cargos do Orçamento) e UM salário por nível (não faixa mín–máx).
--
--   dp_cargos          — cargo da estrutura da empresa.
--   dp_cargo_niveis    — níveis do cargo, cada um com o seu salário.
--   dp_cargo_vinculos  — de-para cargo da SÓLIDES → nível da estrutura, POR
--                        EMPRESA: o cargo da Sólides é um só para o grupo
--                        (o mesmo "Analista Comercial Pleno III" existe na Spot
--                        e na Franqueadora), e cada empresa tem a sua tabela.
--
-- A Sólides não tem estrutura salarial na API (conferido em 02/10/2026: só
-- id/nome/salário mínimo do cargo, preenchido em 2 dos 309), por isso a
-- estrutura é cadastrada aqui.
--
-- `nome_chave` é a forma normalizada do nome (minúsculas, sem acento, espaço
-- único), calculada no app. É ela que leva o UNIQUE — e não um índice por
-- expressão — para o upsert com on_conflict funcionar (a pegadinha de
-- orcamento_grupo_escopo, ver CLAUDE.md).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.dp_cargos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL CHECK (btrim(nome) <> ''),
  nome_chave  TEXT NOT NULL,
  descricao   TEXT,
  ativo       BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, nome_chave)
);

CREATE TABLE IF NOT EXISTS public.dp_cargo_niveis (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cargo_id    UUID NOT NULL REFERENCES public.dp_cargos(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL CHECK (btrim(nome) <> ''),
  nome_chave  TEXT NOT NULL,
  ordem       INT NOT NULL DEFAULT 0,
  salario     NUMERIC(14,2) NOT NULL CHECK (salario >= 0),
  updated_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cargo_id, nome_chave)
);

CREATE TABLE IF NOT EXISTS public.dp_cargo_vinculos (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  solides_cargo_id   BIGINT NOT NULL,
  solides_cargo_nome TEXT NOT NULL,
  nivel_id           UUID NOT NULL REFERENCES public.dp_cargo_niveis(id) ON DELETE CASCADE,
  updated_by         UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, solides_cargo_id)
);

CREATE INDEX IF NOT EXISTS dp_cargo_niveis_cargo_idx ON public.dp_cargo_niveis (cargo_id, ordem);
CREATE INDEX IF NOT EXISTS dp_cargo_vinculos_nivel_idx ON public.dp_cargo_vinculos (nivel_id);

-- ── RLS: mesma regra do módulo — só com a concessão, nunca is_admin(). Sem
-- policy de escrita: o app grava com o admin client depois de requireDpUser().
ALTER TABLE public.dp_cargos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dp_cargo_niveis   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dp_cargo_vinculos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dp_cargos_select ON public.dp_cargos;
CREATE POLICY dp_cargos_select ON public.dp_cargos
  FOR SELECT TO authenticated USING (public.dp_has_access());

DROP POLICY IF EXISTS dp_cargo_niveis_select ON public.dp_cargo_niveis;
CREATE POLICY dp_cargo_niveis_select ON public.dp_cargo_niveis
  FOR SELECT TO authenticated USING (public.dp_has_access());

DROP POLICY IF EXISTS dp_cargo_vinculos_select ON public.dp_cargo_vinculos;
CREATE POLICY dp_cargo_vinculos_select ON public.dp_cargo_vinculos
  FOR SELECT TO authenticated USING (public.dp_has_access());

COMMENT ON TABLE public.dp_cargos IS 'DP (sigiloso): cargos da estrutura de cada empresa. Escrita só service role.';
COMMENT ON TABLE public.dp_cargo_niveis IS 'DP: níveis de cada cargo, um salário por nível.';
COMMENT ON TABLE public.dp_cargo_vinculos IS 'DP: de-para cargo da Sólides → nível da estrutura, por empresa.';
