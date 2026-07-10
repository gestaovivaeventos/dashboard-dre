-- Exclusão lógica (soft delete) + edição administrativa de requisições.
--
-- Admin pode editar/excluir uma requisição direto da tela de Requisições. A
-- exclusão é LÓGICA (deleted_at) — preserva o histórico (ctrl_history) e é
-- reversível. Todas as leituras que somam/listam requisições passam a ignorar
-- linhas com deleted_at preenchido.
--
-- Por que não mexemos em ctrl_budget aqui: o consumo do orçamento é calculado
-- dinamicamente a partir de ctrl_requests (performBudgetVerification / tela de
-- Orçamento). Ao ocultar a linha excluída das leituras, o valor volta a ficar
-- livre automaticamente — decrementar ctrl_budget além disso descontaria em
-- dobro.

ALTER TABLE public.ctrl_requests
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.users(id);

-- Índice parcial: as leituras filtram por deleted_at IS NULL, quase sempre
-- combinado com status.
CREATE INDEX IF NOT EXISTS idx_ctrl_requests_not_deleted
  ON public.ctrl_requests (status)
  WHERE deleted_at IS NULL;

-- Novas ações no histórico da requisição.
ALTER TYPE public.ctrl_history_action ADD VALUE IF NOT EXISTS 'editado';
ALTER TYPE public.ctrl_history_action ADD VALUE IF NOT EXISTS 'excluido';
