-- Módulo VB (Viva Bank): créditos de sócios/credores que emprestaram ao grupo
-- na construção do Terrazzo. Substitui a planilha "VB TERRAZZO".
--
-- Desenho: docs/superpowers/specs/2026-09-09-vb-viva-bank-design.md
--
-- • Acesso por concessão em user_module_roles (module='vb', role 'gestor' |
--   'credor'). Admin NÃO passa por cima — sem a linha, não vê o módulo.
-- • Saldo nunca é gravado: é a soma de vb_entries.amount em ordem de data.
--   sheet_balance guarda o SALDO que a planilha mostrava, só para a revisão.
-- • A importação grava lançamentos com status 'pendente' na própria
--   vb_entries; aprovar o lote muda o status. Não há área de rascunho.

-- ── Tabelas ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.vb_creditors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT true,
  -- Fase 2: sócio logado vendo o próprio extrato (papel 'credor').
  user_id       UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  -- Nome da aba de origem na planilha. Único: é a chave que impede reimportar
  -- um credor já aprovado.
  source_sheet  TEXT NULL,
  sort_order    INT NOT NULL DEFAULT 0,
  notes         TEXT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS vb_creditors_source_sheet_uniq
  ON public.vb_creditors (lower(source_sheet)) WHERE source_sheet IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.vb_import_batches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pendente'
                CHECK (status IN ('pendente', 'aprovado', 'descartado')),
  -- Relatório do parser (abas ignoradas/vazias/puladas, totais por credor).
  summary       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by    UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by   UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at   TIMESTAMPTZ NULL,
  discarded_at  TIMESTAMPTZ NULL
);

-- Só um lote pendente por vez (índice único parcial sobre um valor constante).
CREATE UNIQUE INDEX IF NOT EXISTS vb_import_batches_single_pending
  ON public.vb_import_batches ((status)) WHERE status = 'pendente';

CREATE TABLE IF NOT EXISTS public.vb_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creditor_id     UUID NOT NULL REFERENCES public.vb_creditors(id) ON DELETE CASCADE,
  entry_date      DATE NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('entrada', 'saida', 'rendimento')),
  -- Com sinal: entrada > 0, saída < 0, rendimento com o sinal da planilha.
  amount          NUMERIC(14,2) NOT NULL,
  description     TEXT NULL,
  -- Só rendimento. days segue a convenção da planilha: period_end - period_start.
  period_start    DATE NULL,
  period_end      DATE NULL,
  days            INT NULL,
  -- Fração (0.0335 = 3,35%).
  rate            NUMERIC(12,8) NULL,
  -- mensal = taxa fixa capitalizada por dia (FV); periodo = saldo × taxa do
  -- período; ajuste = valor digitado; cdi = reservado aos juros automáticos.
  rate_basis      TEXT NULL CHECK (rate_basis IN ('mensal', 'periodo', 'ajuste', 'cdi')),
  status          TEXT NOT NULL DEFAULT 'aprovado' CHECK (status IN ('pendente', 'aprovado')),
  import_batch_id UUID NULL REFERENCES public.vb_import_batches(id) ON DELETE RESTRICT,
  source_row      INT NULL,
  sheet_balance   NUMERIC(16,4) NULL,
  -- Importação: linha × 10 + sub (0 rendimento, 1 entrada, 2 saída). Manual: 0.
  sort_order      INT NOT NULL DEFAULT 0,
  flags           TEXT[] NOT NULL DEFAULT '{}',
  created_by      UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Pendente pode carregar valor inválido (0) até o gestor corrigir; aprovado não.
  CONSTRAINT vb_entries_amount_sign CHECK (
    status = 'pendente'
    OR (kind = 'entrada' AND amount > 0)
    OR (kind = 'saida' AND amount < 0)
    OR (kind = 'rendimento' AND amount <> 0)
  ),
  CONSTRAINT vb_entries_period_pair CHECK (
    (period_start IS NULL AND period_end IS NULL)
    OR (period_start IS NOT NULL AND period_end IS NOT NULL AND period_start <= period_end)
  )
);

CREATE INDEX IF NOT EXISTS vb_entries_creditor_order_idx
  ON public.vb_entries (creditor_id, entry_date, sort_order, created_at);
CREATE INDEX IF NOT EXISTS vb_entries_batch_idx
  ON public.vb_entries (import_batch_id) WHERE import_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vb_entries_pending_idx
  ON public.vb_entries (status) WHERE status = 'pendente';

-- ── updated_at ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.vb_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vb_creditors_touch_updated_at ON public.vb_creditors;
CREATE TRIGGER vb_creditors_touch_updated_at
  BEFORE UPDATE ON public.vb_creditors
  FOR EACH ROW EXECUTE FUNCTION public.vb_touch_updated_at();

DROP TRIGGER IF EXISTS vb_entries_touch_updated_at ON public.vb_entries;
CREATE TRIGGER vb_entries_touch_updated_at
  BEFORE UPDATE ON public.vb_entries
  FOR EACH ROW EXECUTE FUNCTION public.vb_touch_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────

ALTER TABLE public.vb_creditors      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vb_entries        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vb_import_batches ENABLE ROW LEVEL SECURITY;

-- Papel do usuário no VB ('gestor' | 'credor' | NULL). Predicado de policy:
-- fica executável por authenticated (regra da auditoria de 03/09/2026).
CREATE OR REPLACE FUNCTION public.vb_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.user_module_roles
  WHERE user_id = auth.uid() AND module = 'vb'
  ORDER BY (role <> 'gestor'), role
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.vb_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vb_role() TO authenticated, service_role;

DROP POLICY IF EXISTS vb_creditors_select ON public.vb_creditors;
CREATE POLICY vb_creditors_select ON public.vb_creditors
  FOR SELECT TO authenticated
  USING (
    public.vb_role() = 'gestor'
    OR (public.vb_role() = 'credor' AND user_id = auth.uid())
  );

DROP POLICY IF EXISTS vb_entries_select ON public.vb_entries;
CREATE POLICY vb_entries_select ON public.vb_entries
  FOR SELECT TO authenticated
  USING (
    (status = 'aprovado' OR public.vb_role() = 'gestor')
    AND EXISTS (
      SELECT 1 FROM public.vb_creditors c
      WHERE c.id = vb_entries.creditor_id
        AND (
          public.vb_role() = 'gestor'
          OR (public.vb_role() = 'credor' AND c.user_id = auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS vb_import_batches_select ON public.vb_import_batches;
CREATE POLICY vb_import_batches_select ON public.vb_import_batches
  FOR SELECT TO authenticated
  USING (public.vb_role() = 'gestor');

-- Sem policy de escrita: toda escrita passa pelo service role, nos server
-- actions, depois de requireVbGestor().

-- ── Aprovação do lote (transação única) ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.vb_approve_import_batch(p_batch_id UUID, p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status   TEXT;
  v_blocking INTEGER;
  v_count    INTEGER;
BEGIN
  SELECT status INTO v_status
  FROM public.vb_import_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Lote não encontrado.';
  END IF;
  IF v_status <> 'pendente' THEN
    RAISE EXCEPTION 'Lote não está pendente.';
  END IF;

  SELECT count(*) INTO v_blocking
  FROM public.vb_entries
  WHERE import_batch_id = p_batch_id
    AND status = 'pendente'
    AND flags && ARRAY['data_invalida', 'valor_invalido']::text[];

  IF v_blocking > 0 THEN
    RAISE EXCEPTION 'Há % lançamento(s) com alerta bloqueante. Corrija antes de aprovar.', v_blocking;
  END IF;

  UPDATE public.vb_entries
  SET status = 'aprovado'
  WHERE import_batch_id = p_batch_id AND status = 'pendente';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.vb_import_batches
  SET status = 'aprovado', approved_by = p_user_id, approved_at = now()
  WHERE id = p_batch_id;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.vb_approve_import_batch(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vb_approve_import_batch(UUID, UUID) TO service_role;

-- ── Concessão inicial ───────────────────────────────────────────────────
-- Só o Marcelo enxerga o módulo no começo. Lookup por e-mail, sem UUID fixo.

INSERT INTO public.user_module_roles (user_id, module, role)
SELECT id, 'vb', 'gestor'
FROM public.users
WHERE lower(email) = 'marcelo@quokka.net.br'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE public.vb_creditors IS
  'VB (Viva Bank): credores/sócios que emprestaram ao grupo. Acesso por concessão em user_module_roles (module=vb).';
COMMENT ON TABLE public.vb_entries IS
  'VB: lançamentos (entrada/saida/rendimento) por credor. Saldo = soma de amount em ordem de data. status=pendente enquanto o lote de importação não é aprovado.';
COMMENT ON TABLE public.vb_import_batches IS
  'VB: lotes de importação da planilha. Um pendente por vez; linhas nunca são apagadas.';
