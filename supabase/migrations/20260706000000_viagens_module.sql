-- Módulo Viagens — requisição de viagem com busca agêntica de preços.
-- Fluxo: usuário pede (origem/destino/período) → sistema cota 3 modais
-- (carro, ônibus, avião) com todos os custos → gerente escolhe → reserva.
-- Escrita real das actions é via service-role/admin client + guards
-- requireViagensUser/requireViagensAprovador; as policies cobrem o fallback.

-- Flags de acesso (mesma mecânica de can_case).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS can_viagens boolean NOT NULL DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS can_viagens_aprovar boolean NOT NULL DEFAULT false;

-- ── Enums ──────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.viagem_request_status AS ENUM
    ('rascunho','buscando','cotado','aprovado','reservado','concluido','rejeitado','erro','cancelado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.viagem_modal AS ENUM ('carro','onibus','aviao');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Requisição ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.viagem_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number     serial UNIQUE,
  origem             text NOT NULL,
  destino            text NOT NULL,
  data_ida           date NOT NULL,
  data_volta         date NOT NULL,
  janela_flex_dias   int  NOT NULL DEFAULT 0 CHECK (janela_flex_dias BETWEEN 0 AND 15),
  passageiros        int  NOT NULL DEFAULT 1 CHECK (passageiros >= 1),
  modo_carro         text NOT NULL DEFAULT 'ambos' CHECK (modo_carro IN ('km','aluguel','ambos')),
  incluir_hospedagem boolean NOT NULL DEFAULT true,
  monitorar          boolean NOT NULL DEFAULT false,
  observacao         text,
  status             public.viagem_request_status NOT NULL DEFAULT 'rascunho',
  chosen_quote_id    uuid,
  approved_by        uuid REFERENCES public.users(id),
  approved_at        timestamptz,
  rejected_reason    text,
  reservado_por      uuid REFERENCES public.users(id),
  reservado_em       timestamptz,
  created_by         uuid NOT NULL REFERENCES public.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (data_volta >= data_ida)
);
CREATE INDEX IF NOT EXISTS viagem_requests_status_idx     ON public.viagem_requests(status);
CREATE INDEX IF NOT EXISTS viagem_requests_created_by_idx ON public.viagem_requests(created_by);

-- ── Cotações (1 linha viva por modal; histórico vai pra snapshots) ─────
CREATE TABLE IF NOT EXISTS public.viagem_quotes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id        uuid NOT NULL REFERENCES public.viagem_requests(id) ON DELETE CASCADE,
  modal             public.viagem_modal NOT NULL,
  provider          text NOT NULL DEFAULT 'estimativa',
  titulo            text,
  detalhes          jsonb,
  custo_transporte  numeric(15,2) NOT NULL DEFAULT 0,
  custo_hospedagem  numeric(15,2) NOT NULL DEFAULT 0,
  custo_traslados   numeric(15,2) NOT NULL DEFAULT 0,
  custo_alimentacao numeric(15,2) NOT NULL DEFAULT 0,
  custo_taxas       numeric(15,2) NOT NULL DEFAULT 0,
  total             numeric(15,2) NOT NULL DEFAULT 0,
  booking_link      text,
  valid_until       timestamptz,
  selected          boolean NOT NULL DEFAULT false,
  captured_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, modal)
);
CREATE INDEX IF NOT EXISTS viagem_quotes_request_idx ON public.viagem_quotes(request_id);

ALTER TABLE public.viagem_requests
  DROP CONSTRAINT IF EXISTS viagem_requests_chosen_quote_fk;
ALTER TABLE public.viagem_requests
  ADD CONSTRAINT viagem_requests_chosen_quote_fk
  FOREIGN KEY (chosen_quote_id) REFERENCES public.viagem_quotes(id) ON DELETE SET NULL;

-- ── Fila de buscas (drenada pelo cron, resumível) ──────────────────────
CREATE TABLE IF NOT EXISTS public.viagem_search_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid NOT NULL REFERENCES public.viagem_requests(id) ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'inicial' CHECK (kind IN ('inicial','monitor')),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  error_log   text,
  started_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS viagem_search_runs_status_idx ON public.viagem_search_runs(status, created_at);

-- ── Histórico de preço (monitoramento contínuo) ────────────────────────
CREATE TABLE IF NOT EXISTS public.viagem_price_snapshots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid NOT NULL REFERENCES public.viagem_requests(id) ON DELETE CASCADE,
  modal       public.viagem_modal NOT NULL,
  total       numeric(15,2) NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS viagem_price_snapshots_req_idx ON public.viagem_price_snapshots(request_id, modal, captured_at);

-- ── Auditoria ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.viagem_history (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.viagem_requests(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES public.users(id),
  action     text NOT NULL,
  comment    text,
  metadata   jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS viagem_history_request_idx ON public.viagem_history(request_id);

-- ── Notificações (espelha ctrl_notifications) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.viagem_notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  request_id uuid REFERENCES public.viagem_requests(id) ON DELETE SET NULL,
  title      text NOT NULL,
  message    text NOT NULL,
  type       text NOT NULL DEFAULT 'info',
  is_read    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS viagem_notifications_user_idx ON public.viagem_notifications(user_id, is_read);

-- ── Config global (singleton) — parâmetros de custo do carro/ônibus ────
CREATE TABLE IF NOT EXISTS public.viagem_config (
  id                       int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  rate_per_km              numeric(10,2) NOT NULL DEFAULT 1.80,
  aluguel_diaria           numeric(10,2) NOT NULL DEFAULT 150.00,
  preco_combustivel_litro  numeric(10,2) NOT NULL DEFAULT 6.20,
  consumo_km_litro         numeric(10,2) NOT NULL DEFAULT 11.00,
  tarifa_onibus_km         numeric(10,4) NOT NULL DEFAULT 0.4200,
  diaria_alimentacao       numeric(10,2) NOT NULL DEFAULT 80.00,
  hotel_diaria_padrao      numeric(10,2) NOT NULL DEFAULT 250.00,
  updated_at               timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.viagem_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── Guards RLS ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_viagens_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND active
      AND (can_viagens = true OR profile = 'admin' OR role = 'admin')
  );
$$;
GRANT EXECUTE ON FUNCTION public.has_viagens_access() TO authenticated;

CREATE OR REPLACE FUNCTION public.has_viagens_aprovar()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND active
      AND (can_viagens_aprovar = true OR profile = 'admin' OR role = 'admin')
  );
$$;
GRANT EXECUTE ON FUNCTION public.has_viagens_aprovar() TO authenticated;

-- ── RLS: membros do módulo leem/escrevem; guard real fica nas actions ──
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'viagem_requests','viagem_quotes','viagem_search_runs',
    'viagem_price_snapshots','viagem_history','viagem_config'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_rw ON public.%1$s;', t);
    EXECUTE format($f$
      CREATE POLICY %1$s_rw ON public.%1$s FOR ALL TO authenticated
      USING (public.has_viagens_access())
      WITH CHECK (public.has_viagens_access());
    $f$, t);
  END LOOP;
END $$;

-- Notificações: cada usuário só vê as suas.
ALTER TABLE public.viagem_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS viagem_notifications_own ON public.viagem_notifications;
CREATE POLICY viagem_notifications_own ON public.viagem_notifications
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
