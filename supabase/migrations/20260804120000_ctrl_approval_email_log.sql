-- Log da rotina diária de lembretes de aprovação do módulo de Compras.
--
-- A tabela é, ao mesmo tempo, o RASTRO (quem foi notificado, quando, com quais
-- requisições, com que resultado no Resend) e a TRAVA DE DUPLICIDADE: a chave
-- única (user_id, run_date) garante um e-mail por usuário por dia mesmo que o
-- cron seja reexecutado manualmente no mesmo dia.
--
-- `run_date` é o dia em BRASÍLIA (calculado na aplicação por todayBR()), não o
-- dia UTC — a rotina roda às 10h BRT (13h UTC) e o dia precisa bater com o que
-- o usuário vê nas telas do Control Hub.
--
-- `fortune` guarda a "mensagem do dia" enviada: é ela que alimenta o histórico
-- usado para não repetir a mesma frase para o mesmo usuário em dias próximos.

CREATE TABLE IF NOT EXISTS public.ctrl_approval_email_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date        DATE NOT NULL,
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  -- Etapa que originou a pendência: 'gerente', 'diretor' ou 'misto' (o usuário
  -- acumula os dois papéis e recebeu requisições das duas etapas no mesmo e-mail).
  stage           TEXT NOT NULL CHECK (stage IN ('gerente', 'diretor', 'misto')),
  request_count   INT NOT NULL DEFAULT 0,
  request_ids     UUID[] NOT NULL DEFAULT '{}',
  fortune         TEXT,
  -- 'enviando' = linha reservada antes da chamada ao Resend (evita corrida entre
  -- duas execuções simultâneas). Só 'enviado' bloqueia reprocessamento: 'erro'
  -- pode ser reenviado numa nova execução do mesmo dia.
  status          TEXT NOT NULL DEFAULT 'enviando' CHECK (status IN ('enviando', 'enviado', 'erro')),
  resend_id       TEXT,
  error           TEXT,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ctrl_approval_email_log_user_day_unique UNIQUE (user_id, run_date)
);

CREATE INDEX IF NOT EXISTS ctrl_approval_email_log_run_date_idx
  ON public.ctrl_approval_email_log (run_date DESC);

-- Histórico por usuário: alimenta a escolha da mensagem do dia (evita repetir as
-- últimas frases) e a consulta "o que foi enviado para fulano".
CREATE INDEX IF NOT EXISTS ctrl_approval_email_log_user_recent_idx
  ON public.ctrl_approval_email_log (user_id, run_date DESC);

ALTER TABLE public.ctrl_approval_email_log ENABLE ROW LEVEL SECURITY;

-- A rotina escreve com o service role (bypassa RLS). Leitura fica restrita a
-- admin — é um log operacional, não conteúdo de usuário.
DROP POLICY IF EXISTS ctrl_approval_email_log_read_admin ON public.ctrl_approval_email_log;
CREATE POLICY ctrl_approval_email_log_read_admin
  ON public.ctrl_approval_email_log
  FOR SELECT
  USING (public.is_admin());

COMMENT ON TABLE public.ctrl_approval_email_log IS
  'Rastro + trava de duplicidade da rotina diaria de lembrete de aprovacoes (Compras). Um registro por usuario por dia (BRT).';
