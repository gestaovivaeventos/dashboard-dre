-- ============================================================
-- Control Hub — Tabelas do módulo Controladoria
-- Prefixo ctrl_ isola as tabelas no schema público
-- ============================================================

-- Enums
CREATE TYPE public.ctrl_request_status AS ENUM (
  'pendente',
  'aprovado',
  'rejeitado',
  'aguardando_complementacao',
  'estornado',
  'agendado',
  'travado',
  'inativado_csc',
  'aguardando_aprovacao_fornecedor'
);

CREATE TYPE public.ctrl_supplier_status AS ENUM (
  'pendente',
  'aprovado',
  'rejeitado'
);

CREATE TYPE public.ctrl_history_action AS ENUM (
  'criado',
  'aprovado',
  'rejeitado',
  'complementado',
  'complementacao_solicitada',
  'estornado',
  'agendado',
  'travado',
  'inativado',
  'fornecedor_aprovado',
  'fornecedor_rejeitado'
);

-- Setores da organização
CREATE TABLE public.ctrl_sectors (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT    NOT NULL UNIQUE,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ctrl_sectors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ctrl_sectors_read" ON public.ctrl_sectors
  FOR SELECT TO authenticated
  USING (public.has_ctrl_role(ARRAY['admin','solicitante','gerente','diretor','csc']));

CREATE POLICY "ctrl_sectors_write" ON public.ctrl_sectors
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Tipos de despesa
CREATE TABLE public.ctrl_expense_types (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ctrl_expense_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ctrl_expense_types_read" ON public.ctrl_expense_types
  FOR SELECT TO authenticated
  USING (public.has_ctrl_role(ARRAY['admin','solicitante','gerente','diretor','csc']));

CREATE POLICY "ctrl_expense_types_write" ON public.ctrl_expense_types
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Fornecedores
CREATE TABLE public.ctrl_suppliers (
  id               UUID                        PRIMARY KEY DEFAULT gen_random_uuid(),
  omie_id          BIGINT                      UNIQUE,
  name             TEXT                        NOT NULL,
  cnpj_cpf         TEXT,
  email            TEXT,
  phone            TEXT,
  status           public.ctrl_supplier_status NOT NULL DEFAULT 'pendente',
  rejection_reason TEXT,
  created_by       UUID                        REFERENCES public.users(id),
  approved_by      UUID                        REFERENCES public.users(id),
  approved_at      TIMESTAMPTZ,
  from_omie        BOOLEAN                     NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ                 NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ                 NOT NULL DEFAULT now()
);

CREATE INDEX ctrl_suppliers_status_idx ON public.ctrl_suppliers(status);

ALTER TABLE public.ctrl_suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ctrl_suppliers_read" ON public.ctrl_suppliers
  FOR SELECT TO authenticated
  USING (public.has_ctrl_role(ARRAY['admin','solicitante','gerente','diretor','csc']));

CREATE POLICY "ctrl_suppliers_write_admin" ON public.ctrl_suppliers
  FOR ALL TO authenticated
  USING (public.has_ctrl_role(ARRAY['admin','csc']))
  WITH CHECK (public.has_ctrl_role(ARRAY['admin','csc']));

CREATE POLICY "ctrl_suppliers_insert_any" ON public.ctrl_suppliers
  FOR INSERT TO authenticated
  WITH CHECK (public.has_ctrl_role(ARRAY['admin','solicitante','gerente','diretor','csc']));

-- Vínculo fornecedor <-> tipo de despesa
CREATE TABLE public.ctrl_supplier_expense_types (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id     UUID NOT NULL REFERENCES public.ctrl_suppliers(id) ON DELETE CASCADE,
  expense_type_id UUID NOT NULL REFERENCES public.ctrl_expense_types(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, expense_type_id)
);

ALTER TABLE public.ctrl_supplier_expense_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ctrl_set_read" ON public.ctrl_supplier_expense_types
  FOR SELECT TO authenticated
  USING (public.has_ctrl_role(ARRAY['admin','solicitante','gerente','diretor','csc']));

CREATE POLICY "ctrl_set_write" ON public.ctrl_supplier_expense_types
  FOR ALL TO authenticated
  USING (public.has_ctrl_role(ARRAY['admin','csc']))
  WITH CHECK (public.has_ctrl_role(ARRAY['admin','csc']));

-- Orçamento por setor / tipo / período
CREATE TABLE public.ctrl_budget (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  sector_id       UUID    NOT NULL REFERENCES public.ctrl_sectors(id) ON DELETE CASCADE,
  expense_type_id UUID    REFERENCES public.ctrl_expense_types(id) ON DELETE SET NULL,
  period_year     INT     NOT NULL,
  period_month    INT     NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  amount          NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sector_id, expense_type_id, period_year, period_month)
);

ALTER TABLE public.ctrl_budget ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ctrl_budget_read" ON public.ctrl_budget
  FOR SELECT TO authenticated
  USING (public.has_ctrl_role(ARRAY['admin','gerente','diretor','csc']));

CREATE POLICY "ctrl_budget_write" ON public.ctrl_budget
  FOR ALL TO authenticated
  USING (public.has_ctrl_role(ARRAY['admin','csc']))
  WITH CHECK (public.has_ctrl_role(ARRAY['admin','csc']));

-- Requisições de pagamento
CREATE TABLE public.ctrl_requests (
  id              UUID                        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number  SERIAL                      UNIQUE,
  title           TEXT                        NOT NULL,
  description     TEXT,
  sector_id       UUID                        NOT NULL REFERENCES public.ctrl_sectors(id),
  expense_type_id UUID                        REFERENCES public.ctrl_expense_types(id),
  supplier_id     UUID                        REFERENCES public.ctrl_suppliers(id),
  amount          NUMERIC(15,2)               NOT NULL CHECK (amount > 0),
  due_date        DATE,
  status          public.ctrl_request_status  NOT NULL DEFAULT 'pendente',
  approval_level  INT                         NOT NULL DEFAULT 0,
  created_by      UUID                        NOT NULL REFERENCES public.users(id),
  approved_by     UUID                        REFERENCES public.users(id),
  approved_at     TIMESTAMPTZ,
  rejected_at     TIMESTAMPTZ,
  scheduled_for   DATE,
  created_at      TIMESTAMPTZ                 NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ                 NOT NULL DEFAULT now()
);

CREATE INDEX ctrl_requests_status_idx     ON public.ctrl_requests(status);
CREATE INDEX ctrl_requests_created_by_idx ON public.ctrl_requests(created_by);
CREATE INDEX ctrl_requests_sector_id_idx  ON public.ctrl_requests(sector_id);

ALTER TABLE public.ctrl_requests ENABLE ROW LEVEL SECURITY;

-- solicitante vê apenas as próprias
CREATE POLICY "ctrl_requests_read_own" ON public.ctrl_requests
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    AND public.has_ctrl_role(ARRAY['solicitante'])
  );

-- gerente/diretor/csc/admin veem todas
CREATE POLICY "ctrl_requests_read_all" ON public.ctrl_requests
  FOR SELECT TO authenticated
  USING (public.has_ctrl_role(ARRAY['admin','gerente','diretor','csc']));

CREATE POLICY "ctrl_requests_insert" ON public.ctrl_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_ctrl_role(ARRAY['admin','solicitante','gerente','diretor','csc'])
    AND created_by = auth.uid()
  );

CREATE POLICY "ctrl_requests_update" ON public.ctrl_requests
  FOR UPDATE TO authenticated
  USING (public.has_ctrl_role(ARRAY['admin','gerente','diretor','csc']))
  WITH CHECK (public.has_ctrl_role(ARRAY['admin','gerente','diretor','csc']));

-- Histórico de ações em requisições
CREATE TABLE public.ctrl_history (
  id         UUID                        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID                        NOT NULL REFERENCES public.ctrl_requests(id) ON DELETE CASCADE,
  user_id    UUID                        NOT NULL REFERENCES public.users(id),
  action     public.ctrl_history_action  NOT NULL,
  comment    TEXT,
  created_at TIMESTAMPTZ                 NOT NULL DEFAULT now()
);

CREATE INDEX ctrl_history_request_id_idx ON public.ctrl_history(request_id);

ALTER TABLE public.ctrl_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ctrl_history_read" ON public.ctrl_history
  FOR SELECT TO authenticated
  USING (public.has_ctrl_role(ARRAY['admin','solicitante','gerente','diretor','csc']));

CREATE POLICY "ctrl_history_insert" ON public.ctrl_history
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_ctrl_role(ARRAY['admin','solicitante','gerente','diretor','csc'])
    AND user_id = auth.uid()
  );

-- Notificações internas
CREATE TABLE public.ctrl_notifications (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID    NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title      TEXT    NOT NULL,
  message    TEXT    NOT NULL,
  type       TEXT    NOT NULL DEFAULT 'info',
  read       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ctrl_notifications_user_idx ON public.ctrl_notifications(user_id, read);

ALTER TABLE public.ctrl_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ctrl_notifications_own" ON public.ctrl_notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Service role pode inserir notificações para qualquer usuário
CREATE POLICY "ctrl_notifications_insert" ON public.ctrl_notifications
  FOR INSERT TO authenticated
  WITH CHECK (public.has_ctrl_role(ARRAY['admin','gerente','diretor','csc']));
