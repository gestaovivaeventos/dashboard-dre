-- Etapa 5 (BV — saldo do contrato).
-- 1) Campos da RP para o casamento de contrato: fundo + fornecedor (CNPJ) +
--    número do contrato.
ALTER TABLE public.contract_validation_items
  ADD COLUMN IF NOT EXISTS fundo text,
  ADD COLUMN IF NOT EXISTS numero_contrato text;

-- 2) Base de RPs já pagas (importada via seed). O sistema soma valor_pago por
--    (fundo + cpf_cnpj + numero_contrato) e compara com o valor do contrato.
CREATE TABLE IF NOT EXISTS public.contract_paid_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fundo           text,
  fornecedor      text,
  cpf_cnpj        text,
  numero_contrato text,
  valor_pago      numeric(15,2) NOT NULL DEFAULT 0,
  data_pagamento  text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Índice do casamento (dígitos do CNPJ entram normalizados na query).
CREATE INDEX IF NOT EXISTS contract_paid_history_match_idx
  ON public.contract_paid_history (fundo, cpf_cnpj, numero_contrato);

ALTER TABLE public.contract_paid_history ENABLE ROW LEVEL SECURITY;

-- Leitura para autenticados (o pipeline usa service role e ignora RLS); escrita
-- só via service role (seed) — sem policy de write para authenticated.
CREATE POLICY "contract_paid_history_read" ON public.contract_paid_history
  FOR SELECT TO authenticated USING (true);
