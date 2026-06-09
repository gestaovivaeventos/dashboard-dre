-- Novo estado de aprovação: requisição fora do orçamento aprovada pelo gerente
-- aguarda a aprovação do diretor antes de ir para 'aprovado'.
-- O solicitante especial (regra de roteamento) nasce direto neste estado.
ALTER TYPE ctrl_request_status ADD VALUE IF NOT EXISTS 'pendente_diretor' AFTER 'pendente';
