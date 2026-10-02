-- ============================================================================
-- Departamento Pessoal — base cadastral (fase 1 do roteiro da reunião com o DP,
-- 02/10/2026). Depende de 20260929160000 e 20261002140000.
--
-- 1. Campos novos no espelho da Sólides, liberados pelo dono do projeto em
--    02/10/2026 (mudam a decisão de 29/09, que os deixava de fora): data de
--    nascimento (faixa etária do plano de saúde), dependentes (IRRF e plano),
--    fim do 1º período de experiência + duração ("2 x 45 dias") para o alerta, e
--    os benefícios cadastrados na ficha. Férias e exames, que a ficha também
--    traz, continuam FORA até decisão própria.
-- 2. Centros de custo: cadastro do DP por empresa. Centro de custo ≠
--    departamento/setor — o DP trata como coisas diferentes.
-- 3. O PADRÃO de centro de custo é da LINHA da tabela salarial (setor + cargo).
-- 4. Ajustes manuais por pessoa (dp_colaborador_ajustes): a EXCEÇÃO à linha do
--    cargo e ao centro de custo padrão. Tabela separada de propósito: o espelho
--    é reescrito pela sincronização todo dia, e o que o DP decidiu à mão não
--    pode depender de uma coluna que um upsert futuro poderia sobrescrever.
-- ============================================================================

ALTER TABLE public.dp_colaboradores
  ADD COLUMN IF NOT EXISTS data_nascimento      DATE,
  ADD COLUMN IF NOT EXISTS experiencia_fim      DATE,
  ADD COLUMN IF NOT EXISTS experiencia_duracao  TEXT,
  ADD COLUMN IF NOT EXISTS dependentes          JSONB,
  ADD COLUMN IF NOT EXISTS beneficios_solides   JSONB,
  -- Versão do conjunto de campos já lido da ficha. O histórico só compara um
  -- campo novo a partir da 2ª leitura dele: sem isto, a primeira sincronização
  -- depois desta migration registraria "nascimento: — → 12/03/1990" para as
  -- 207 pessoas, como se fosse movimentação. 1 = antes desta migration.
  ADD COLUMN IF NOT EXISTS ficha_versao         INT NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.dp_colaboradores.experiencia_fim IS
  'contractExpirationDate da Sólides = fim do 1º período de experiência (admissão + 45 em 49 de 55 fichas, 02/10/2026).';
COMMENT ON COLUMN public.dp_colaboradores.experiencia_duracao IS
  'durationContract da Sólides, texto livre ("2 x 45 dias", "Indeterminado"...).';

-- ── Centros de custo ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dp_centros_custo (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  codigo      TEXT NOT NULL DEFAULT '',
  nome        TEXT NOT NULL CHECK (btrim(nome) <> ''),
  -- Nome normalizado no app (chaveNome); UNIQUE em coluna comum, não índice
  -- por expressão (a pegadinha de orcamento_grupo_escopo).
  nome_chave  TEXT NOT NULL,
  ativo       BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, nome_chave)
);

-- Padrão de centro de custo por linha da tabela salarial. SET NULL ao excluir o
-- centro de custo: a linha volta a "sem centro de custo", não some.
ALTER TABLE public.dp_tabela_salarial
  ADD COLUMN IF NOT EXISTS centro_custo_id UUID REFERENCES public.dp_centros_custo(id) ON DELETE SET NULL;

-- ── Ajustes manuais por pessoa ──────────────────────────────────────────────
-- Uma linha por colaborador com algum ajuste. Chave = solides_id (estável; é a
-- identidade do espelho). Coluna nula = sem exceção naquele item (vale o
-- automático). A linha da tabela e o centro de custo são conferidos contra a
-- empresa do colaborador no app.
CREATE TABLE IF NOT EXISTS public.dp_colaborador_ajustes (
  solides_id       BIGINT PRIMARY KEY REFERENCES public.dp_colaboradores(solides_id) ON DELETE CASCADE,
  linha_id         UUID REFERENCES public.dp_tabela_salarial(id) ON DELETE SET NULL,
  linha_motivo     TEXT,
  centro_custo_id  UUID REFERENCES public.dp_centros_custo(id) ON DELETE SET NULL,
  centro_motivo    TEXT,
  updated_by       UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── RLS: só com a concessão do módulo, nunca is_admin(); sem policy de escrita.
ALTER TABLE public.dp_centros_custo       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dp_colaborador_ajustes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dp_centros_custo_select ON public.dp_centros_custo;
CREATE POLICY dp_centros_custo_select ON public.dp_centros_custo
  FOR SELECT TO authenticated USING (public.dp_has_access());

DROP POLICY IF EXISTS dp_colaborador_ajustes_select ON public.dp_colaborador_ajustes;
CREATE POLICY dp_colaborador_ajustes_select ON public.dp_colaborador_ajustes
  FOR SELECT TO authenticated USING (public.dp_has_access());

COMMENT ON TABLE public.dp_centros_custo IS 'DP (sigiloso): centros de custo de cada empresa (≠ departamento/setor).';
COMMENT ON TABLE public.dp_colaborador_ajustes IS
  'DP: exceções manuais por colaborador — linha da tabela salarial e centro de custo — sobre o automático (cargo da Sólides / padrão da linha).';
