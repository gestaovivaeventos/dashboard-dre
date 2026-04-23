-- ============================================================
-- Control Hub — Schema completo para ctrl_requests
-- Alinha com todos os campos do sistema original (janetao)
-- ============================================================

-- Eventos (usado em requisições para rastreabilidade)
CREATE TABLE IF NOT EXISTS public.ctrl_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  description TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_by  UUID        REFERENCES public.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ctrl_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ctrl_events_read" ON public.ctrl_events
  FOR SELECT TO authenticated
  USING (public.has_ctrl_role(ARRAY['admin','solicitante','gerente','diretor','csc']));

CREATE POLICY "ctrl_events_write" ON public.ctrl_events
  FOR ALL TO authenticated
  USING (public.has_ctrl_role(ARRAY['admin','csc']))
  WITH CHECK (public.has_ctrl_role(ARRAY['admin','csc']));

-- Grupos de recorrência
CREATE TABLE IF NOT EXISTS public.ctrl_recurrence_groups (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  original_request_id UUID        REFERENCES public.ctrl_requests(id),
  months              INT[]       NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'cancelado')),
  created_by          UUID        REFERENCES public.users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Notificações internas da Controladoria
CREATE TABLE IF NOT EXISTS public.ctrl_notifications (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  request_id UUID        REFERENCES public.ctrl_requests(id) ON DELETE SET NULL,
  title      TEXT        NOT NULL,
  message    TEXT        NOT NULL,
  type       TEXT        NOT NULL DEFAULT 'info',
  is_read    BOOLEAN     NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ctrl_notifications_user_idx ON public.ctrl_notifications(user_id);
CREATE INDEX ctrl_notifications_read_idx ON public.ctrl_notifications(user_id, is_read);

ALTER TABLE public.ctrl_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ctrl_notifications_own" ON public.ctrl_notifications
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- Colunas adicionais em ctrl_requests
-- ============================================================

-- Método de pagamento
ALTER TABLE public.ctrl_requests
  ADD COLUMN IF NOT EXISTS payment_method TEXT
    CHECK (payment_method IN ('boleto','pix','transferencia','cartao_credito','dinheiro'));

-- Mês / Ano de referência orçamentária
ALTER TABLE public.ctrl_requests
  ADD COLUMN IF NOT EXISTS reference_month INT CHECK (reference_month BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS reference_year  INT;

-- Dados bancários (TED/transferência)
ALTER TABLE public.ctrl_requests
  ADD COLUMN IF NOT EXISTS bank_name          TEXT,
  ADD COLUMN IF NOT EXISTS bank_agency        TEXT,
  ADD COLUMN IF NOT EXISTS bank_account       TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_digit TEXT,
  ADD COLUMN IF NOT EXISTS bank_cpf_cnpj      TEXT;

-- Dados PIX
ALTER TABLE public.ctrl_requests
  ADD COLUMN IF NOT EXISTS pix_key      TEXT,
  ADD COLUMN IF NOT EXISTS pix_key_type TEXT
    CHECK (pix_key_type IN ('cpf','cnpj','email','telefone','aleatoria'));

-- Dados de pagamento em dinheiro / boleto
ALTER TABLE public.ctrl_requests
  ADD COLUMN IF NOT EXISTS favorecido TEXT,
  ADD COLUMN IF NOT EXISTS barcode    TEXT;

-- Informações adicionais
ALTER TABLE public.ctrl_requests
  ADD COLUMN IF NOT EXISTS supplier_issues_invoice TEXT
    CHECK (supplier_issues_invoice IN ('sim','nao','nao_sei')),
  ADD COLUMN IF NOT EXISTS justification TEXT,
  ADD COLUMN IF NOT EXISTS observations  TEXT;

-- Controle orçamentário
ALTER TABLE public.ctrl_requests
  ADD COLUMN IF NOT EXISTS is_budgeted                  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS using_accumulated_balance    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS supplier_changed             BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS supplier_change_justification TEXT,
  ADD COLUMN IF NOT EXISTS approval_tier                TEXT
    CHECK (approval_tier IN ('nivel_2','nivel_3'));

-- Parcelamento
ALTER TABLE public.ctrl_requests
  ADD COLUMN IF NOT EXISTS installment_number   INT,
  ADD COLUMN IF NOT EXISTS installment_total    INT,
  ADD COLUMN IF NOT EXISTS installment_group_id UUID;

-- Recorrência
ALTER TABLE public.ctrl_requests
  ADD COLUMN IF NOT EXISTS is_recurring         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurrence_group_id  UUID REFERENCES public.ctrl_recurrence_groups(id);

-- Evento
ALTER TABLE public.ctrl_requests
  ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES public.ctrl_events(id) ON DELETE SET NULL;

-- Contas a pagar
ALTER TABLE public.ctrl_requests
  ADD COLUMN IF NOT EXISTS sent_to_payment_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_to_payment_by  UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS paying_company      TEXT;

-- Inativação CSC
ALTER TABLE public.ctrl_requests
  ADD COLUMN IF NOT EXISTS inactivated_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inactivated_by     UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS inactivation_reason TEXT;

-- Estorno
ALTER TABLE public.ctrl_requests
  ADD COLUMN IF NOT EXISTS reversed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT;

-- Índices úteis
CREATE INDEX IF NOT EXISTS ctrl_requests_payment_idx     ON public.ctrl_requests(sent_to_payment_at);
CREATE INDEX IF NOT EXISTS ctrl_requests_approval_tier_idx ON public.ctrl_requests(approval_tier);

-- ============================================================
-- Enum: ações de histórico faltantes
-- ============================================================
ALTER TYPE public.ctrl_history_action ADD VALUE IF NOT EXISTS 'info_respondida';
ALTER TYPE public.ctrl_history_action ADD VALUE IF NOT EXISTS 'inativado_csc';

-- ============================================================
-- Adiciona campo metadata no ctrl_history (para auditoria)
-- ============================================================
ALTER TABLE public.ctrl_history
  ADD COLUMN IF NOT EXISTS metadata JSONB;
