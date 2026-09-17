-- Módulo Caixa: saldo das contas correntes de TODAS as empresas do grupo,
-- lido da Omie. Primeira tela: "Caixa Real" (/caixa/real).
--
-- • Acesso por concessão em user_module_roles (module='caixa', role='user').
--   Diferente do VB, admin JÁ enxerga (modelo do Case / Contratos).
-- • Quem tem o módulo vê TODAS as empresas. Este módulo NÃO herda a regra de
--   empresas restritas (@/lib/auth/restricted-companies, hoje a Dataforte) —
--   decisão explícita do dono do projeto, não esquecimento: a pergunta que a
--   tela responde ("quanto o grupo tem em caixa agora") só faz sentido com o
--   grupo inteiro na conta, e esconder uma empresa devolveria um total errado
--   sem avisar ninguém. Ver o comentário em src/lib/auth/caixa.ts.
-- • O saldo AQUI é gravado, ao contrário do VB. Lá o saldo é derivado de
--   lançamentos nossos (somar é a verdade); aqui é uma OBSERVAÇÃO EXTERNA
--   feita num instante, então só vale com carimbo de hora junto.

-- ── Contas correntes (espelho do cadastro da Omie) ──────────────────────

CREATE TABLE IF NOT EXISTS public.caixa_accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- nCodCC da Omie. TEXT porque é um id de 11 dígitos que não usamos em conta.
  omie_cc_id     TEXT NOT NULL,
  descricao      TEXT NOT NULL DEFAULT '',
  -- tipo_conta_corrente: CC (conta corrente), CX (caixinha/caixa físico),
  -- CA (aplicação), AD (adiantamento). A tela filtra por isto.
  tipo           TEXT NULL,
  -- codigo_banco / codigo_agencia / numero_conta_corrente do cadastro Omie.
  -- Banco 999 é o placeholder da Omie para caixa físico (sem banco de verdade).
  banco_codigo   TEXT NULL,
  agencia        TEXT NULL,
  conta          TEXT NULL,
  -- Espelha `inativo` da Omie. Conta que some do cadastro NUNCA é apagada
  -- (o histórico de saldo dela continua sendo um fato): vira ativo=false.
  ativo          BOOLEAN NOT NULL DEFAULT true,

  -- ── Saldo corrente, desnormalizado ────────────────────────────────────
  -- A tela lê uma query só, sem varrer snapshots. O histórico completo fica
  -- em caixa_balance_snapshots.
  saldo          NUMERIC(16,2) NULL,
  saldo_at       TIMESTAMPTZ NULL,
  -- Última falha ao buscar o saldo desta conta. Preenchido = o número acima
  -- está velho, e a tela TEM que mostrar isso (saldo velho sem aviso é pior
  -- que saldo nenhum).
  saldo_error    TEXT NULL,

  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (company_id, omie_cc_id)
);

CREATE INDEX IF NOT EXISTS caixa_accounts_company_idx
  ON public.caixa_accounts (company_id);

-- ── Snapshots de saldo ──────────────────────────────────────────────────
-- Uma linha por captura (2x/dia pelo cron + as manuais). É o que permite a
-- coluna "variação no dia" e auditar por que um número mudou.

CREATE TABLE IF NOT EXISTS public.caixa_balance_snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES public.caixa_accounts(id) ON DELETE CASCADE,
  captured_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Dia em Brasília (não em UTC): a "variação no dia" é o dia no Brasil, e às
  -- 22h de um dia o servidor em UTC já está no dia seguinte.
  captured_day      DATE NOT NULL
                    DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date),
  -- nSaldoAtual com dPeriodoFinal = hoje. Ver a nota sobre o período em
  -- src/lib/caixa/omie/balances.ts.
  saldo             NUMERIC(16,2) NOT NULL,
  saldo_disponivel  NUMERIC(16,2) NULL,
  saldo_conciliado  NUMERIC(16,2) NULL,
  source            TEXT NOT NULL DEFAULT 'cron'
                    CHECK (source IN ('cron', 'manual'))
);

CREATE INDEX IF NOT EXISTS caixa_snapshots_account_captured_idx
  ON public.caixa_balance_snapshots (account_id, captured_at DESC);

-- ── Execuções (cron e manuais) ──────────────────────────────────────────
-- Responde "por que o saldo está velho?" sem precisar de log da Vercel.

CREATE TABLE IF NOT EXISTS public.caixa_sync_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             TEXT NOT NULL CHECK (kind IN ('cadastro', 'saldos')),
  trigger          TEXT NOT NULL CHECK (trigger IN ('cron', 'manual')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ NULL,
  companies_total  INT NOT NULL DEFAULT 0,
  companies_ok     INT NOT NULL DEFAULT 0,
  accounts_ok      INT NOT NULL DEFAULT 0,
  accounts_error   INT NOT NULL DEFAULT 0,
  -- [{ company_id, company_name, error }]
  errors           JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_by       UUID NULL REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS caixa_sync_runs_started_idx
  ON public.caixa_sync_runs (started_at DESC);

-- ── RLS ─────────────────────────────────────────────────────────────────

ALTER TABLE public.caixa_accounts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caixa_balance_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caixa_sync_runs          ENABLE ROW LEVEL SECURITY;

-- Tem acesso ao módulo Caixa? Predicado de policy: fica executável por
-- authenticated (regra da auditoria de 03/09/2026 — só predicados de policy
-- ficam liberados; funções que leem dado de empresa vão só para service_role).
--
-- Admin entra sem a linha, de propósito (modelo Case/Contratos). Não há
-- recorte por empresa: quem tem o módulo vê todas.
CREATE OR REPLACE FUNCTION public.caixa_has_access()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = (SELECT auth.uid())
      AND u.active
      AND (
        u.profile = 'admin'
        OR u.role = 'admin'
        OR EXISTS (
          SELECT 1 FROM public.user_module_roles r
          WHERE r.user_id = u.id AND r.module = 'caixa'
        )
      )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.caixa_has_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caixa_has_access() TO authenticated, service_role;

DROP POLICY IF EXISTS caixa_accounts_select ON public.caixa_accounts;
CREATE POLICY caixa_accounts_select ON public.caixa_accounts
  FOR SELECT TO authenticated
  USING (public.caixa_has_access());

DROP POLICY IF EXISTS caixa_snapshots_select ON public.caixa_balance_snapshots;
CREATE POLICY caixa_snapshots_select ON public.caixa_balance_snapshots
  FOR SELECT TO authenticated
  USING (public.caixa_has_access());

DROP POLICY IF EXISTS caixa_sync_runs_select ON public.caixa_sync_runs;
CREATE POLICY caixa_sync_runs_select ON public.caixa_sync_runs
  FOR SELECT TO authenticated
  USING (public.caixa_has_access());

-- Sem policy de escrita: toda escrita passa pelo service role, nas rotas, e
-- só depois do gate do módulo (requireCaixaUser).
