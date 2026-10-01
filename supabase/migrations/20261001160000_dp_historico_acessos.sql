-- ============================================================================
-- Departamento Pessoal — histórico de movimentações e registro de acessos.
-- Depende de 20260929150000 (dp_has_access) e 20260929160000 (dp_colaboradores).
--
--   dp_colaborador_eventos — o que a sincronização PERCEBEU que mudou (salário,
--     cargo, unidade, gestor…), entrada, desligamento e reativação. A Sólides
--     não devolve histórico; ele só existe a partir do dia em que esta tabela
--     começou a ser preenchida. Data = DETECÇÃO, não vigência.
--   dp_acessos — quem abriu a ficha de quem (a ficha mostra salário, CPF e
--     endereço). Só leitura no app; ninguém edita nem apaga pelo PostgREST.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.dp_colaborador_eventos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  solides_id     BIGINT NOT NULL REFERENCES public.dp_colaboradores(solides_id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL CHECK (tipo IN ('entrada', 'desligamento', 'reativacao', 'alteracao')),
  campo          TEXT,
  valor_anterior JSONB,
  valor_novo     JSONB,
  run_id         UUID REFERENCES public.dp_sync_runs(id) ON DELETE SET NULL,
  detectado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dp_colaborador_eventos_colab_idx ON public.dp_colaborador_eventos (solides_id, detectado_em DESC);
CREATE INDEX IF NOT EXISTS dp_colaborador_eventos_data_idx ON public.dp_colaborador_eventos (detectado_em DESC);

CREATE TABLE IF NOT EXISTS public.dp_acessos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES public.users(id) ON DELETE SET NULL,
  colaborador_id UUID NOT NULL REFERENCES public.dp_colaboradores(id) ON DELETE CASCADE,
  acao           TEXT NOT NULL DEFAULT 'ficha' CHECK (acao IN ('ficha')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dp_acessos_colab_idx ON public.dp_acessos (colaborador_id, created_at DESC);

-- Eventos de alteração precisam de campo; os outros três não têm.
ALTER TABLE public.dp_colaborador_eventos DROP CONSTRAINT IF EXISTS dp_colaborador_eventos_campo_chk;
ALTER TABLE public.dp_colaborador_eventos ADD CONSTRAINT dp_colaborador_eventos_campo_chk
  CHECK ((tipo = 'alteracao') = (campo IS NOT NULL));

-- ── RLS: mesma regra do resto do módulo — só com a concessão, nunca is_admin().
ALTER TABLE public.dp_colaborador_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dp_acessos             ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dp_colaborador_eventos_select ON public.dp_colaborador_eventos;
CREATE POLICY dp_colaborador_eventos_select ON public.dp_colaborador_eventos
  FOR SELECT TO authenticated USING (public.dp_has_access());

DROP POLICY IF EXISTS dp_acessos_select ON public.dp_acessos;
CREATE POLICY dp_acessos_select ON public.dp_acessos
  FOR SELECT TO authenticated USING (public.dp_has_access());

COMMENT ON TABLE public.dp_colaborador_eventos IS
  'DP: movimentações detectadas pela sincronização com a Sólides (data = detecção). Escrita só service role.';
COMMENT ON TABLE public.dp_acessos IS
  'DP: registro de quem abriu cada ficha de colaborador. Escrita só service role, sem UPDATE/DELETE pelo app.';
