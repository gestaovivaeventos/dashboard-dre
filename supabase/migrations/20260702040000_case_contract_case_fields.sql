-- Campos do modelo CASE Shows (checkboxes, tipo de evento, cortesias, data de
-- assinatura e testemunhas) que passam a compor o contrato de venda gerado.
ALTER TABLE public.case_contracts
  ADD COLUMN IF NOT EXISTS espec_area_interna       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS espec_area_externa       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS espec_palco              boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS espec_trio               boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS extra_transporte_cidade  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS extra_translado_local    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS extra_diaria_alimentacao boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS extra_hospedagem         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tipo_evento              text,
  ADD COLUMN IF NOT EXISTS cortesias                text,
  ADD COLUMN IF NOT EXISTS data_assinatura          date,
  ADD COLUMN IF NOT EXISTS testemunha_1_nome        text,
  ADD COLUMN IF NOT EXISTS testemunha_1_cpf         text,
  ADD COLUMN IF NOT EXISTS testemunha_2_nome        text,
  ADD COLUMN IF NOT EXISTS testemunha_2_cpf         text;

ALTER TABLE public.case_contracts
  DROP CONSTRAINT IF EXISTS case_contracts_tipo_evento_chk;
ALTER TABLE public.case_contracts
  ADD CONSTRAINT case_contracts_tipo_evento_chk
  CHECK (tipo_evento IS NULL OR tipo_evento IN ('aberto', 'fechado'));
