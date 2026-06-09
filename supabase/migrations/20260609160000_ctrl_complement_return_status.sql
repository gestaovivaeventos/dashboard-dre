-- Guarda a etapa de aprovação de onde a requisição saiu ao entrar em
-- "aguardando_complementacao", para retornar a ela quando o solicitante
-- responder (gerente vs diretor) — em vez de sempre voltar para 'pendente'.
ALTER TABLE ctrl_requests
  ADD COLUMN IF NOT EXISTS complement_return_status TEXT;
