// Erros compartilhados do módulo Orçamento.

/**
 * Detecta o erro típico de quando a migration 20260727140000 (tabelas do
 * módulo Orçamento) ainda não foi aplicada no banco — a relação não existe.
 */
export function isSchemaMissing(message: string): boolean {
  return /does not exist/i.test(message) &&
    /orcamento_company_config|orcamento_setores|relation/i.test(message);
}

/** Mensagem amigável para colisão de nome único (setor duplicado). */
export function friendlySetorError(message: string): string {
  if (/duplicate key|unique/i.test(message)) {
    return "Já existe um setor com esse nome nesta empresa.";
  }
  return message;
}
