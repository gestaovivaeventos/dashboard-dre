-- Aprovação interna do contrato Case antes da ClickSign.
-- Fluxo: rascunho → aguardando_aprovacao (Pedro) → aguardando_assinatura
-- (cliente + testemunha, depois o Pedro assina por último) → assinado.
ALTER TYPE public.case_contract_status ADD VALUE IF NOT EXISTS 'aguardando_aprovacao';

ALTER TYPE public.case_history_action ADD VALUE IF NOT EXISTS 'aprovacao_solicitada';
ALTER TYPE public.case_history_action ADD VALUE IF NOT EXISTS 'aprovado';
ALTER TYPE public.case_history_action ADD VALUE IF NOT EXISTS 'devolvido';

ALTER TABLE public.case_contracts
  ADD COLUMN IF NOT EXISTS approval_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_requested_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.users(id);
