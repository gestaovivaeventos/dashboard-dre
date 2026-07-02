-- Case: fluxo de assinatura ClickSign + dados do objeto/contratante do contrato.
-- Os ALTER TYPE ADD VALUE são aplicados fora de transação (autocommit) antes de
-- qualquer uso dos novos valores.
ALTER TYPE public.case_contract_status ADD VALUE IF NOT EXISTS 'aguardando_assinatura';
ALTER TYPE public.case_contract_status ADD VALUE IF NOT EXISTS 'assinado';
ALTER TYPE public.case_history_action  ADD VALUE IF NOT EXISTS 'enviado_assinatura';
ALTER TYPE public.case_history_action  ADD VALUE IF NOT EXISTS 'assinado';

ALTER TABLE public.case_contracts
  ADD COLUMN IF NOT EXISTS sale_contract_path       text,
  ADD COLUMN IF NOT EXISTS show_time                text,
  ADD COLUMN IF NOT EXISTS show_duration            text,
  ADD COLUMN IF NOT EXISTS passagem_som             text,
  ADD COLUMN IF NOT EXISTS local_name               text,
  ADD COLUMN IF NOT EXISTS local_address            text,
  ADD COLUMN IF NOT EXISTS local_city               text,
  ADD COLUMN IF NOT EXISTS local_cep                text,
  ADD COLUMN IF NOT EXISTS especificacoes           text,
  ADD COLUMN IF NOT EXISTS clicksign_document_key   text,
  ADD COLUMN IF NOT EXISTS clicksign_signer_key     text,
  ADD COLUMN IF NOT EXISTS clicksign_request_key    text,
  ADD COLUMN IF NOT EXISTS clicksign_status         text,
  ADD COLUMN IF NOT EXISTS sign_url                 text,
  ADD COLUMN IF NOT EXISTS sent_for_signature_at    timestamptz,
  ADD COLUMN IF NOT EXISTS signed_at                timestamptz;

CREATE INDEX IF NOT EXISTS case_contracts_clicksign_doc_idx
  ON public.case_contracts(clicksign_document_key);

ALTER TABLE public.case_clients
  ADD COLUMN IF NOT EXISTS resp_legal      text,
  ADD COLUMN IF NOT EXISTS cpf_resp_legal  text,
  ADD COLUMN IF NOT EXISTS endereco        text,
  ADD COLUMN IF NOT EXISTS cidade_estado   text,
  ADD COLUMN IF NOT EXISTS cep             text;
