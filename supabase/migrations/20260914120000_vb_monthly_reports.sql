-- supabase/migrations/20260914120000_vb_monthly_reports.sql
-- Extrato mensal por e-mail para os credores do VB.
--
-- 1) E-mail do credor: um endereço por credor, opcional. Credor sem e-mail
--    aparece na tela de Relatórios mensais como "sem e-mail" e não trava os
--    outros.
-- 2) Registro de envios: cada disparo (oficial, teste ou reenvio) vira uma
--    linha. O status da tela é DERIVADO (sem coluna de status): "enviado" é
--    existir um envio oficial daquele credor naquele mês. O extrato enviado
--    fica congelado em `statement` para auditoria — o que o credor recebeu,
--    mesmo que lançamentos entrem depois.

ALTER TABLE public.vb_creditors
  ADD COLUMN IF NOT EXISTS email TEXT;

COMMENT ON COLUMN public.vb_creditors.email IS
  'Destinatário do extrato mensal. Nulo = credor não recebe (fica marcado na tela).';

CREATE TABLE IF NOT EXISTS public.vb_report_sends (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creditor_id UUID NOT NULL REFERENCES public.vb_creditors(id) ON DELETE CASCADE,
  -- 'YYYY-MM' do extrato.
  month       TEXT NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  -- oficial = foi ao credor; teste = só para quem clicou; reenvio = oficial repetido conscientemente.
  kind        TEXT NOT NULL CHECK (kind IN ('oficial', 'teste', 'reenvio')),
  sent_to     TEXT NOT NULL,
  sent_by     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  subject     TEXT NOT NULL,
  resend_id   TEXT,
  statement   JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS vb_report_sends_creditor_month
  ON public.vb_report_sends (creditor_id, month, sent_at DESC);

ALTER TABLE public.vb_report_sends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vb_report_sends_select ON public.vb_report_sends;
CREATE POLICY vb_report_sends_select ON public.vb_report_sends
  FOR SELECT TO authenticated USING (public.vb_role() = 'gestor');
-- Sem policy de escrita: só o service role grava, depois de requireVbGestor().

COMMENT ON TABLE public.vb_report_sends IS
  'Envios do extrato mensal do VB por credor e mês (oficial, teste, reenvio), com o extrato congelado.';
