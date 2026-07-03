-- Fase D: e-mail da testemunha 1 (assina o contrato pelo ClickSign junto com o
-- cliente e o contratado). Preenchido no formulário, na hora.
ALTER TABLE public.case_contracts
  ADD COLUMN IF NOT EXISTS testemunha_1_email text;
