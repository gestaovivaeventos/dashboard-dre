-- Módulo Case (Case Shows) — agenciamento de shows.
-- Registra contratos de venda de atrações e lança no Omie:
--   • conta a PAGAR ao artista  (categoria Custódia de Valores de Artistas)
--   • conta a RECEBER do cliente (parte custódia + parte serviços/comissões-BV)
-- Escrita real das actions é via service-role/admin client + guard requireCaseRole;
-- as policies abaixo cobrem o fallback via client de sessão.

-- Flag de acesso ao módulo (mesma mecânica de can_financeiro / can_compras).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS can_case boolean NOT NULL DEFAULT false;

-- ── Enums ──────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.case_contract_status AS ENUM ('rascunho','lancado','parcial','erro','cancelado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.case_leg_kind AS ENUM ('pagar_custodia','receber_custodia','receber_servicos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.case_title_status AS ENUM ('pendente','lancado','erro');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.case_history_action AS ENUM ('criado','editado','lancado','relancado','erro','cancelado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Clientes (contratante) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.case_clients (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  cnpj_cpf       text,
  pessoa_fisica  boolean NOT NULL DEFAULT false,
  email          text,
  phone          text,
  omie_codigo    bigint,
  omie_synced_at timestamptz,
  created_by     uuid REFERENCES public.users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS case_clients_doc_uidx
  ON public.case_clients (regexp_replace(coalesce(cnpj_cpf,''),'\D','','g'))
  WHERE cnpj_cpf IS NOT NULL AND cnpj_cpf <> '';

-- ── Bandas / Artistas (fornecedor) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.case_bands (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  cnpj_cpf       text,
  pessoa_fisica  boolean NOT NULL DEFAULT false,
  email          text,
  phone          text,
  banco          text,
  agencia        text,
  conta_corrente text,
  titular_banco  text,
  doc_titular    text,
  chave_pix      text,
  omie_codigo    bigint,
  omie_synced_at timestamptz,
  created_by     uuid REFERENCES public.users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS case_bands_doc_uidx
  ON public.case_bands (regexp_replace(coalesce(cnpj_cpf,''),'\D','','g'))
  WHERE cnpj_cpf IS NOT NULL AND cnpj_cpf <> '';

-- ── Contrato ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.case_contracts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_number       serial UNIQUE,
  company_id            uuid NOT NULL REFERENCES public.companies(id),
  client_id             uuid NOT NULL REFERENCES public.case_clients(id),
  band_id               uuid NOT NULL REFERENCES public.case_bands(id),
  event_name            text,
  event_date            date,
  valor_artista         numeric(15,2) NOT NULL CHECK (valor_artista >= 0),
  valor_atracao_cliente numeric(15,2) NOT NULL CHECK (valor_atracao_cliente >= 0),
  valor_rider           numeric(15,2) NOT NULL DEFAULT 0 CHECK (valor_rider >= 0),
  valor_camarim         numeric(15,2) NOT NULL DEFAULT 0 CHECK (valor_camarim >= 0),
  valor_extras          numeric(15,2) NOT NULL DEFAULT 0 CHECK (valor_extras >= 0),
  valor_custodia        numeric(15,2) NOT NULL DEFAULT 0,
  valor_margem          numeric(15,2) NOT NULL DEFAULT 0,
  valor_servicos        numeric(15,2) NOT NULL DEFAULT 0,
  attachment_path       text,
  status                public.case_contract_status NOT NULL DEFAULT 'rascunho',
  observacao            text,
  created_by            uuid NOT NULL REFERENCES public.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (valor_artista <= valor_atracao_cliente)
);
CREATE INDEX IF NOT EXISTS case_contracts_client_idx     ON public.case_contracts(client_id);
CREATE INDEX IF NOT EXISTS case_contracts_band_idx       ON public.case_contracts(band_id);
CREATE INDEX IF NOT EXISTS case_contracts_status_idx     ON public.case_contracts(status);
CREATE INDEX IF NOT EXISTS case_contracts_event_date_idx ON public.case_contracts(event_date);

-- ── Títulos (parcelas) — 1 linha = 1 título Omie ───────────────────────
CREATE TABLE IF NOT EXISTS public.case_titles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id       uuid NOT NULL REFERENCES public.case_contracts(id) ON DELETE CASCADE,
  leg               public.case_leg_kind NOT NULL,
  parcela_numero    int NOT NULL CHECK (parcela_numero >= 1),
  parcela_total     int NOT NULL CHECK (parcela_total >= 1),
  vencimento        date NOT NULL,
  valor             numeric(15,2) NOT NULL CHECK (valor > 0),
  codigo_integracao text NOT NULL,
  omie_codigo       bigint,
  status            public.case_title_status NOT NULL DEFAULT 'pendente',
  launch_error      text,
  launched_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (codigo_integracao)
);
CREATE INDEX IF NOT EXISTS case_titles_contract_idx ON public.case_titles(contract_id);
CREATE INDEX IF NOT EXISTS case_titles_status_idx   ON public.case_titles(status);

-- ── Config Omie da Case (mapeamento categorias + conta corrente) ───────
CREATE TABLE IF NOT EXISTS public.case_omie_config (
  company_id                uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  codigo_categoria_custodia text,
  codigo_categoria_servicos text,
  codigo_conta_corrente     text,
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- ── Cache das opções Omie (espelha ctrl_omie_options) ──────────────────
CREATE TABLE IF NOT EXISTS public.case_omie_options (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('categoria','conta_corrente')),
  codigo     text NOT NULL,
  descricao  text,
  synced_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, kind, codigo)
);
CREATE INDEX IF NOT EXISTS case_omie_options_company_kind_idx ON public.case_omie_options(company_id, kind);

-- ── Histórico ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.case_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.case_contracts(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES public.users(id),
  action      public.case_history_action NOT NULL,
  comment     text,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS case_history_contract_idx ON public.case_history(contract_id);

-- ── Guard RLS ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_case_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND active
      AND (can_case = true OR profile = 'admin' OR role = 'admin')
  );
$$;
GRANT EXECUTE ON FUNCTION public.has_case_access() TO authenticated;

-- ── RLS: membros do módulo leem/escrevem; guard real fica nas actions ──
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'case_clients','case_bands','case_contracts','case_titles',
    'case_omie_config','case_omie_options','case_history'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format($f$
      CREATE POLICY %1$s_rw ON public.%1$s FOR ALL TO authenticated
      USING (public.has_case_access())
      WITH CHECK (public.has_case_access());
    $f$, t);
  END LOOP;
END $$;

-- ── Storage: bucket privado dos anexos de contrato ─────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('case-attachments','case-attachments', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY case_attachments_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'case-attachments' AND (auth.uid())::text = (storage.foldername(name))[1]);
CREATE POLICY case_attachments_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'case-attachments' AND (auth.uid())::text = (storage.foldername(name))[1]);
CREATE POLICY case_attachments_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'case-attachments' AND (auth.uid())::text = (storage.foldername(name))[1]);
