-- =============================================================================
-- Módulo Orçamento — remoção das tabelas do Planejamento ANTIGO.
--
-- `orcamento_planejamento_socios` e `orcamento_planejamento_socios_itens` eram
-- o modelo em que o item orçado vivia dentro do jsonb `proposta` da categoria.
-- Desde `20260925120000` a despesa é linha própria
-- (`orcamento_planejamento_despesas`), com base e entrevista em tabelas
-- separadas, e NENHUM código do app lê mais as tabelas antigas — o último a
-- migrar foi `actions/validacao.ts` / `actions/retorno.ts`.
--
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ APLIQUE ESTA MIGRATION DEPOIS DO DEPLOY DO CÓDIGO NOVO.                   │
-- │                                                                          │
-- │ Ela é DESTRUTIVA e não tem volta: os dados do planejamento antigo (base   │
-- │ curada, conversas e propostas) são apagados junto. Isso foi acordado —    │
-- │ o dono do projeto classificou esses dados como descartáveis em            │
-- │ 23/09/2026 —, mas se a tela nova ainda estiver sendo conferida, não há    │
-- │ pressa: as tabelas paradas não atrapalham nada.                          │
-- └──────────────────────────────────────────────────────────────────────────┘
--
-- Idempotente.
-- =============================================================================

-- A ordem importa: `_itens` referencia o mesmo escopo, e a tabela de setores
-- tem FK RESTRICT vinda das duas. CASCADE cobre índices, triggers e policies.
DROP TABLE IF EXISTS public.orcamento_planejamento_socios_itens CASCADE;
DROP TABLE IF EXISTS public.orcamento_planejamento_socios CASCADE;

NOTIFY pgrst, 'reload schema';
