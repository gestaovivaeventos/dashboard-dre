-- =============================================================================
-- Módulo Orçamento — Despesas com pessoal, ETAPA 3 (encargos e prévia mensal).
--
-- Duas mudanças que a prévia mensal do orçamento exige:
--
-- 1. ADMISSÃO como tipo de movimentação. Até aqui o quadro só previa mudança de
--    cargo e desligamento, então um colaborador a ser CONTRATADO em maio era
--    contado desde janeiro e inflava a folha do ano inteiro. Com 'admissao', o
--    colaborador só passa a existir a partir do mês informado.
--
-- 2. ALÍQUOTAS DE ENCARGOS por empresa × ano. O regime tributário da empresa
--    (companies.regime_tributario) dá o PADRÃO — no Simples Nacional a CPP está
--    dentro do DAS e não há INSS patronal nem terceiros; no Lucro Presumido/Real
--    incidem 20% + RAT×FAP + terceiros. Mas RAT e FAP variam por CNAE e são
--    calculados empresa a empresa, então cada empresa pode sobrescrever o padrão
--    no seu ano. Uma linha por (empresa, ano); sem linha, a aplicação usa o
--    padrão do regime.
--
-- Alíquotas gravadas em PONTOS PERCENTUAIS (20 = 20%), como os índices de
-- correção do módulo, para o número da tela ser o número do banco.
-- =============================================================================

-- ─── 1. Tipo de movimentação 'admissao' ─────────────────────────────────────
-- Troca os CHECK de mov1_tipo/mov2_tipo. Drop por DESCOBERTA (pg_constraint) e
-- pelo CONTEÚDO do check, não por nome: o nome original foi gerado pelo Postgres
-- na criação inline da coluna. O filtro por 'movimentacao' pega os dois checks
-- (mov1 e mov2) e não encosta no de vinculo, que lista clt/pj/estagio. Ao
-- reaplicar, derruba os checks novos e os recria — idempotente.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.orcamento_pessoal_colaboradores'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%movimentacao%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.orcamento_pessoal_colaboradores DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.orcamento_pessoal_colaboradores
  ADD CONSTRAINT orcamento_pessoal_colab_mov1_tipo_check
  CHECK (mov1_tipo IS NULL OR mov1_tipo IN ('admissao', 'movimentacao', 'desligamento'));

ALTER TABLE public.orcamento_pessoal_colaboradores
  ADD CONSTRAINT orcamento_pessoal_colab_mov2_tipo_check
  CHECK (mov2_tipo IS NULL OR mov2_tipo IN ('admissao', 'movimentacao', 'desligamento'));

-- ─── 2. Alíquotas de encargos por empresa × ano ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.orcamento_encargos (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year integer NOT NULL,

  -- Pontos percentuais sobre a folha (20 = 20%).
  inss_patronal numeric CHECK (inss_patronal IS NULL OR inss_patronal >= 0),
  rat_fap       numeric CHECK (rat_fap IS NULL OR rat_fap >= 0),
  terceiros     numeric CHECK (terceiros IS NULL OR terceiros >= 0),
  fgts          numeric CHECK (fgts IS NULL OR fgts >= 0),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,

  PRIMARY KEY (company_id, year)
);

DROP TRIGGER IF EXISTS orcamento_encargos_touch_updated_at_trg ON public.orcamento_encargos;
CREATE TRIGGER orcamento_encargos_touch_updated_at_trg
BEFORE UPDATE ON public.orcamento_encargos
FOR EACH ROW EXECUTE FUNCTION public.orcamento_touch_updated_at();

-- ─── RLS — admin-only, como o resto do módulo ───────────────────────────────
ALTER TABLE public.orcamento_encargos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orcamento_encargos admin all" ON public.orcamento_encargos;
CREATE POLICY "orcamento_encargos admin all"
ON public.orcamento_encargos
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());
