-- ============================================================================
-- Validação mensal dos relatórios BI (One Page Report) antes do envio aos
-- gestores das unidades.
--
-- Fluxo:
--   dia 4  → cron sincroniza 6 meses da Omie, gera o relatório do MÊS ANTERIOR
--            de cada empresa com assinantes e grava aqui (status
--            'pendente_validacao') + notifica o CSC;
--   CSC    → na tela /financeiro/validacao-relatorio: Aceitar / Revisão /
--            Adicionar contexto;
--   aceite → envio em 1 clique via Resend para os destinatários da PRÓPRIA
--            empresa (bi_report_subscriptions);
--   dia 10 → cron envia automaticamente o que ainda não foi enviado.
--
-- ISOLAMENTO: a chave natural é (company_id, period_from, period_to). Um
-- relatório pertence a UMA empresa e a UM período — nunca é reaproveitado
-- entre empresas. O `report_json` guarda a resposta COMPLETA da geração
-- (mesma estrutura consumida pela tela de Business Intelligence), de modo que
-- o e-mail enviado é renderizado a partir do MESMO objeto exibido na tela.
-- ============================================================================

-- ── Quem pode validar/enviar relatórios BI ─────────────────────────────────
-- Admin + perfil CSC + os dois e-mails nominais pedidos pelo negócio.
-- Usado pelas policies abaixo (defesa em profundidade: os crons e as rotas
-- usam service-role, e a tela valida o mesmo conjunto no server).
CREATE OR REPLACE FUNCTION public.can_validate_bi_reports()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.active
      AND (
        u.role = 'admin'
        OR u.profile::text = 'admin'
        OR u.profile::text = 'csc'
        OR lower(u.email) IN ('marcela@quokka.net.br', 'marcelo@quokka.net.br')
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_validate_bi_reports() TO authenticated;

-- ── Tabela principal: um relatório por empresa × período ───────────────────
CREATE TABLE IF NOT EXISTS public.bi_report_validations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  period_from   date NOT NULL,
  period_to     date NOT NULL,
  period_label  text NOT NULL,

  -- Status do fluxo de validação (ver /financeiro/validacao-relatorio).
  status        text NOT NULL DEFAULT 'pendente_validacao'
    CHECK (status IN (
      'pendente_validacao',
      'em_revisao',
      'contexto_adicionado',
      'aceito',
      'enviado_manual',
      'enviado_automatico',
      'erro_envio',
      'erro_geracao'
    )),

  -- Versão do relatório: +1 a cada regeração (revisão concluída ou contexto
  -- adicionado). O histórico textual fica em bi_report_validation_contexts e
  -- bi_report_validation_events.
  version          integer NOT NULL DEFAULT 1,
  -- Resposta COMPLETA da geração (analysis + input + blocos numéricos) —
  -- exatamente o corpo que /api/intelligence/one-page devolve à tela.
  report_json      jsonb,
  generated_at     timestamptz,
  generation_error text,
  -- Último contexto de negócio aplicado pela IA (histórico na tabela filha).
  extra_context    text,

  -- Aceite
  accepted_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  accepted_at   timestamptz,

  -- Revisão
  review_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  review_at     timestamptz,
  review_note   text,

  -- Envio
  sent_at         timestamptz,
  sent_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  sent_mode       text CHECK (sent_mode IN ('manual', 'automatico')),
  sent_recipients text[] NOT NULL DEFAULT '{}',
  send_error      text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Garante 1 relatório por empresa/período: o cron do dia 4 é idempotente e
  -- o do dia 10 nunca duplica envio.
  UNIQUE (company_id, period_from, period_to)
);

CREATE INDEX IF NOT EXISTS bi_report_validations_period_idx
  ON public.bi_report_validations(period_from DESC, period_to DESC);
CREATE INDEX IF NOT EXISTS bi_report_validations_status_idx
  ON public.bi_report_validations(status);

-- ── Histórico de contextos adicionados pelo CSC ────────────────────────────
CREATE TABLE IF NOT EXISTS public.bi_report_validation_contexts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  validation_id uuid NOT NULL REFERENCES public.bi_report_validations(id) ON DELETE CASCADE,
  -- Redundante de propósito: torna impossível ler o contexto de uma empresa
  -- no relatório de outra sem violar a FK/consulta.
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  context_text  text NOT NULL,
  -- Versão do relatório gerada COM este contexto (null enquanto não aplicado).
  applied_version integer,
  created_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bi_report_validation_contexts_validation_idx
  ON public.bi_report_validation_contexts(validation_id, created_at DESC);

-- ── Log de auditoria (geração, aceite, revisão, contexto, envio) ───────────
CREATE TABLE IF NOT EXISTS public.bi_report_validation_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  validation_id uuid NOT NULL REFERENCES public.bi_report_validations(id) ON DELETE CASCADE,
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  action        text NOT NULL,
  actor_id      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  actor_label   text,
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bi_report_validation_events_validation_idx
  ON public.bi_report_validation_events(validation_id, created_at DESC);

-- ── updated_at automático ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bi_report_validations_touch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bi_report_validations_touch_trg ON public.bi_report_validations;
CREATE TRIGGER bi_report_validations_touch_trg
  BEFORE UPDATE ON public.bi_report_validations
  FOR EACH ROW EXECUTE FUNCTION public.bi_report_validations_touch();

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.bi_report_validations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bi_report_validation_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bi_report_validation_events   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bi_report_validations_rw" ON public.bi_report_validations;
CREATE POLICY "bi_report_validations_rw"
  ON public.bi_report_validations FOR ALL TO authenticated
  USING (public.can_validate_bi_reports())
  WITH CHECK (public.can_validate_bi_reports());

DROP POLICY IF EXISTS "bi_report_validation_contexts_rw" ON public.bi_report_validation_contexts;
CREATE POLICY "bi_report_validation_contexts_rw"
  ON public.bi_report_validation_contexts FOR ALL TO authenticated
  USING (public.can_validate_bi_reports())
  WITH CHECK (public.can_validate_bi_reports());

DROP POLICY IF EXISTS "bi_report_validation_events_rw" ON public.bi_report_validation_events;
CREATE POLICY "bi_report_validation_events_rw"
  ON public.bi_report_validation_events FOR ALL TO authenticated
  USING (public.can_validate_bi_reports())
  WITH CHECK (public.can_validate_bi_reports());
