ALTER TABLE public.ctrl_expense_types
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

UPDATE public.ctrl_expense_types
SET active = true
WHERE active IS DISTINCT FROM true;
