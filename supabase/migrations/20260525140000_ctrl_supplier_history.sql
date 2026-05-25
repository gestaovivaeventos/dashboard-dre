-- Historico de alteracoes em fornecedores. Cada acao (criado, editado,
-- aprovado, rejeitado) gera uma linha. Campo `changes` armazena o diff
-- (campo -> [antes, depois]) pra editado, e null para os demais.

CREATE TABLE IF NOT EXISTS public.ctrl_supplier_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES public.ctrl_suppliers(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  changes     JSONB,
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ctrl_supplier_history_supplier_idx
  ON public.ctrl_supplier_history(supplier_id, created_at DESC);

ALTER TABLE public.ctrl_supplier_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ctrl_supplier_history_read" ON public.ctrl_supplier_history
  FOR SELECT TO authenticated
  USING (public.has_ctrl_role(ARRAY['admin','solicitante','gerente','diretor','csc']));
