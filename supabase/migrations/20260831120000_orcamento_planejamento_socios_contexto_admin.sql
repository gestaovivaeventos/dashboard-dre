-- Planejamento dos sócios: contexto livre do ADMIN para a IA (Etapa 1).
-- Na seção "Pagos em {ano-1} — o que a IA deve considerar", o administrador que
-- monta o orçamento pode escrever um direcionamento maior (ex.: "vamos trocar de
-- fornecedor de limpeza em março", "não renovar o contrato X"). A IA lê esse
-- texto ANTES de conduzir a entrevista e mantém as perguntas condizentes com ele.
--
--  contexto_admin -> texto livre; NULL/'' = sem contexto extra (comportamento atual)
ALTER TABLE public.orcamento_planejamento_socios
  ADD COLUMN IF NOT EXISTS contexto_admin text;

NOTIFY pgrst, 'reload schema';
