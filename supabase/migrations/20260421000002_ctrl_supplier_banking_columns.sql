-- Banking columns added to ctrl_suppliers during data migration from janetao instance
ALTER TABLE public.ctrl_suppliers
  ADD COLUMN IF NOT EXISTS chave_pix       TEXT,
  ADD COLUMN IF NOT EXISTS banco           TEXT,
  ADD COLUMN IF NOT EXISTS agencia         TEXT,
  ADD COLUMN IF NOT EXISTS conta_corrente  TEXT,
  ADD COLUMN IF NOT EXISTS titular_banco   TEXT,
  ADD COLUMN IF NOT EXISTS doc_titular     TEXT,
  ADD COLUMN IF NOT EXISTS transf_padrao   BOOLEAN DEFAULT false;

-- Enum values present in source instance but missing in destination
ALTER TYPE public.ctrl_history_action ADD VALUE IF NOT EXISTS 'enviado_pagamento';
ALTER TYPE public.ctrl_history_action ADD VALUE IF NOT EXISTS 'info_solicitada';
