-- ============================================================================
-- Departamento Pessoal — TABELA SALARIAL por empresa (substitui o desenho de
-- cargo → níveis da migration 20261002120000).
--
-- Pedido do dono do projeto (02/10/2026): a estrutura entra por planilha
-- `Setor | Cargo | Step | Salário`, uma por empresa, e vira uma TABELA no
-- sistema — linhas ordenáveis, todas as células editáveis, e um reajuste % que
-- corrige todos os salários de uma vez. Uma linha é a unidade, não um cargo
-- com níveis dentro.
--
-- As três tabelas de 20261002120000 são removidas: estavam vazias quando este
-- desenho as substituiu. O bloco abaixo RECUSA a remoção se alguém tiver
-- gravado algo nelas nesse meio-tempo — perder cadastro em silêncio é pior que
-- uma migration que para e pede atenção.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.dp_cargo_vinculos') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.dp_cargo_vinculos) THEN
    RAISE EXCEPTION 'dp_cargo_vinculos tem dados — migre-os antes de substituir a estrutura.';
  END IF;
  IF to_regclass('public.dp_cargo_niveis') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.dp_cargo_niveis) THEN
    RAISE EXCEPTION 'dp_cargo_niveis tem dados — migre-os antes de substituir a estrutura.';
  END IF;
  IF to_regclass('public.dp_cargos') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.dp_cargos) THEN
    RAISE EXCEPTION 'dp_cargos tem dados — migre-os antes de substituir a estrutura.';
  END IF;
END $$;

DROP TABLE IF EXISTS public.dp_cargo_vinculos;
DROP TABLE IF EXISTS public.dp_cargo_niveis;
DROP TABLE IF EXISTS public.dp_cargos;

-- ── A tabela ────────────────────────────────────────────────────────────────
-- `*_chave` = nome normalizado no app (minúsculas, sem acento, sem "(a)").
-- É a chave da importação (casa a linha da planilha com a da tabela) e leva o
-- UNIQUE em colunas comuns — não índice por expressão — para o on_conflict
-- funcionar (a pegadinha de orcamento_grupo_escopo, ver CLAUDE.md).
-- Setor e step vazios são legítimos ('' — cargo sem step, empresa sem setor).
-- `ordem` é fracionária: inserir entre duas linhas é (a + b) / 2, sem
-- renumerar a tabela inteira a cada clique.
CREATE TABLE IF NOT EXISTS public.dp_tabela_salarial (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  setor        TEXT NOT NULL DEFAULT '',
  setor_chave  TEXT NOT NULL DEFAULT '',
  cargo        TEXT NOT NULL CHECK (btrim(cargo) <> ''),
  cargo_chave  TEXT NOT NULL,
  step         TEXT NOT NULL DEFAULT '',
  step_chave   TEXT NOT NULL DEFAULT '',
  salario      NUMERIC(14,2) NOT NULL CHECK (salario >= 0),
  ordem        DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, setor_chave, cargo_chave, step_chave)
);

CREATE INDEX IF NOT EXISTS dp_tabela_salarial_ordem_idx ON public.dp_tabela_salarial (company_id, ordem);

-- De-para cargo da Sólides → LINHA da tabela, por empresa (o cargo da Sólides
-- é um só para o grupo; cada empresa tem a sua tabela).
CREATE TABLE IF NOT EXISTS public.dp_cargo_vinculos (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  solides_cargo_id   BIGINT NOT NULL,
  solides_cargo_nome TEXT NOT NULL,
  linha_id           UUID NOT NULL REFERENCES public.dp_tabela_salarial(id) ON DELETE CASCADE,
  updated_by         UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, solides_cargo_id)
);

CREATE INDEX IF NOT EXISTS dp_cargo_vinculos_linha_idx ON public.dp_cargo_vinculos (linha_id);

-- Histórico dos reajustes: o salário da tabela é sobrescrito, então sem isto
-- não haveria como saber de onde veio o número de hoje.
CREATE TABLE IF NOT EXISTS public.dp_tabela_reajustes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  percentual    NUMERIC(7,4) NOT NULL CHECK (percentual >= 0),
  linhas        INT NOT NULL,
  total_antes   NUMERIC(16,2) NOT NULL,
  total_depois  NUMERIC(16,2) NOT NULL,
  aplicado_por  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  aplicado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dp_tabela_reajustes_company_idx ON public.dp_tabela_reajustes (company_id, aplicado_em DESC);

-- ── Reajuste: um UPDATE + o registro, na MESMA transação ────────────────────
-- Feito no banco para ser tudo ou nada: aplicar linha a linha pelo app deixaria
-- metade da tabela reajustada se a conexão caísse no meio.
CREATE OR REPLACE FUNCTION public.dp_aplicar_reajuste(p_company_id UUID, p_percentual NUMERIC, p_user_id UUID)
RETURNS TABLE (linhas INT, total_antes NUMERIC, total_depois NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_linhas INT;
  v_antes NUMERIC;
  v_depois NUMERIC;
BEGIN
  IF p_percentual IS NULL OR p_percentual < 0 THEN
    RAISE EXCEPTION 'O reajuste precisa ser maior ou igual a zero.' USING ERRCODE = '22023';
  END IF;

  SELECT count(*), coalesce(sum(salario), 0) INTO v_linhas, v_antes
  FROM public.dp_tabela_salarial WHERE company_id = p_company_id;

  UPDATE public.dp_tabela_salarial
     SET salario = round(salario * (1 + p_percentual / 100), 2),
         updated_by = p_user_id,
         updated_at = now()
   WHERE company_id = p_company_id;

  SELECT coalesce(sum(salario), 0) INTO v_depois
  FROM public.dp_tabela_salarial WHERE company_id = p_company_id;

  INSERT INTO public.dp_tabela_reajustes (company_id, percentual, linhas, total_antes, total_depois, aplicado_por)
  VALUES (p_company_id, p_percentual, v_linhas, v_antes, v_depois, p_user_id);

  RETURN QUERY SELECT v_linhas, v_antes, v_depois;
END;
$$;

-- "Ordenar por setor, cargo e step": renumera a tabela inteira de uma vez.
CREATE OR REPLACE FUNCTION public.dp_ordenar_tabela(p_company_id UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.dp_tabela_salarial t
     SET ordem = o.n
    FROM (
      SELECT id, row_number() OVER (ORDER BY setor_chave, cargo_chave, step_chave) AS n
      FROM public.dp_tabela_salarial
      WHERE company_id = p_company_id
    ) o
   WHERE t.id = o.id;
$$;

-- SECURITY DEFINER que grava dados: só service_role (regra da auditoria de
-- 03/09/2026). O app chama com o admin client depois de requireDpUser().
REVOKE EXECUTE ON FUNCTION public.dp_aplicar_reajuste(UUID, NUMERIC, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dp_aplicar_reajuste(UUID, NUMERIC, UUID) TO service_role;
REVOKE EXECUTE ON FUNCTION public.dp_ordenar_tabela(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dp_ordenar_tabela(UUID) TO service_role;

-- ── RLS: só com a concessão do módulo, nunca is_admin(); sem policy de escrita.
ALTER TABLE public.dp_tabela_salarial  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dp_cargo_vinculos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dp_tabela_reajustes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dp_tabela_salarial_select ON public.dp_tabela_salarial;
CREATE POLICY dp_tabela_salarial_select ON public.dp_tabela_salarial
  FOR SELECT TO authenticated USING (public.dp_has_access());

DROP POLICY IF EXISTS dp_cargo_vinculos_select ON public.dp_cargo_vinculos;
CREATE POLICY dp_cargo_vinculos_select ON public.dp_cargo_vinculos
  FOR SELECT TO authenticated USING (public.dp_has_access());

DROP POLICY IF EXISTS dp_tabela_reajustes_select ON public.dp_tabela_reajustes;
CREATE POLICY dp_tabela_reajustes_select ON public.dp_tabela_reajustes
  FOR SELECT TO authenticated USING (public.dp_has_access());

COMMENT ON TABLE public.dp_tabela_salarial IS 'DP (sigiloso): tabela salarial de cada empresa — Setor | Cargo | Step | Salário.';
COMMENT ON TABLE public.dp_cargo_vinculos IS 'DP: de-para cargo da Sólides → linha da tabela salarial, por empresa.';
COMMENT ON TABLE public.dp_tabela_reajustes IS 'DP: histórico dos reajustes % aplicados à tabela salarial.';
