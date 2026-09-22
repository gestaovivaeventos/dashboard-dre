-- =============================================================================
-- Correção: a trava da diretoria no PLANEJAMENTO.
--
-- A migration da fase B (20260923120000) pôs `diretoria_travado` em quatro
-- tabelas, entre elas `orcamento_planejamento_socios_ITENS` — na premissa de que
-- o item do planejamento fosse uma linha daquela tabela.
--
-- Não é. A Prévia lê o planejamento do jsonb
-- `orcamento_planejamento_socios.proposta`; `_itens` guarda a BASE da
-- entrevista, que não vira orçamento. Então a trava tem de morar na linha
-- CATEGORIA × SETOR — que é o que o construtor reescreve quando edita a
-- proposta — e é lá que o código da fase C a grava e a lê.
--
-- Sem estas colunas, toda ação de trava do planejamento falha com 42703:
-- cancelar/alterar item, liberar, e o guard `travaDaDiretoria`. TypeScript não
-- pega (as consultas do Supabase são strings) e o build passa — apareceu na
-- conferência contra o banco real.
--
-- As colunas em `_itens` ficam: são inofensivas (nullable) e abrem espaço para
-- um cancelamento de item da BASE, se um dia fizer sentido. Não as use
-- esperando efeito no orçamento.
--
-- Idempotente.
-- =============================================================================

ALTER TABLE public.orcamento_planejamento_socios
  ADD COLUMN IF NOT EXISTS diretoria_travado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS diretoria_alterado_em timestamptz,
  ADD COLUMN IF NOT EXISTS diretoria_alterado_por uuid;

NOTIFY pgrst, 'reload schema';
