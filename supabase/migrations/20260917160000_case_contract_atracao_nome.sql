-- Nome da atração no CONTRATO, não no cadastro da banda: o contrato é enviado
-- ao cliente para assinatura antes de a atração ser cadastrada, e é esse nome
-- que sai no documento. Substitui case_bands.nome_artistico (criado e revertido
-- no mesmo dia, sem dados).
ALTER TABLE public.case_contracts
  ADD COLUMN IF NOT EXISTS atracao_nome text;

ALTER TABLE public.case_bands
  DROP COLUMN IF EXISTS nome_artistico;
