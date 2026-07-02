-- Chave de idempotência por submissão do form: evita contratos duplicados quando
-- o usuário clica em "gerar contrato" mais de uma vez.
ALTER TABLE public.case_contracts ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS case_contracts_idempotency_uidx
  ON public.case_contracts(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
