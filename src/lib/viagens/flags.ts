/**
 * Kill-switch do módulo Viagens.
 * false = módulo oculto pra todos (inclusive admin), rotas bloqueadas e cron
 * de busca/monitoramento desligado (zero consumo de OpenAI/API de Voos).
 * Dados e código permanecem intactos — pra reativar, volte pra true.
 */
export const VIAGENS_ENABLED = false;
