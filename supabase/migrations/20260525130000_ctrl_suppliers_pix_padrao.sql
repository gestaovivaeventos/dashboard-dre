-- Marcar PIX como metodo de pagamento padrao do fornecedor (analogo a
-- transf_padrao). Os dois podem coexistir — a UI exibe os dois booleanos.
ALTER TABLE public.ctrl_suppliers
  ADD COLUMN IF NOT EXISTS pix_padrao boolean NOT NULL DEFAULT false;
