-- Lançamentos gravados na mesma operação (vários credores num "Novo lançamento")
-- compartilham o group_id. Não altera saldo nem extrato: é o vínculo que diz
-- "nasceram juntos" (transferência entre credores, juros do mês para todos).
ALTER TABLE public.vb_entries ADD COLUMN IF NOT EXISTS group_id UUID NULL;

CREATE INDEX IF NOT EXISTS vb_entries_group_idx
  ON public.vb_entries (group_id) WHERE group_id IS NOT NULL;

COMMENT ON COLUMN public.vb_entries.group_id IS
  'Lançamentos gravados na mesma operação (vários credores) compartilham o id.';
