// Erros compartilhados do módulo Orçamento.

/**
 * Detecta o erro típico de quando uma migration do módulo Orçamento ainda não
 * foi aplicada (ou a tabela nova ainda não entrou no cache de schema do
 * PostgREST). Duas fraseologias diferentes:
 *  - relação ausente de fato: "... does not exist" (relation/coluna);
 *  - PostgREST não achou no cache: "Could not find the table 'public.X' in the
 *    schema cache" (PGRST205) — some logo após um ALTER/CREATE pelo SQL Editor,
 *    antes do `NOTIFY pgrst, 'reload schema'` propagar.
 */
export function isSchemaMissing(message: string): boolean {
  const m = message ?? "";
  if (/does not exist/i.test(m) && /orcamento_|relation/i.test(m)) return true;
  if (/could not find the (table|column).*schema cache/i.test(m)) return true;
  if (/schema cache/i.test(m) && /orcamento_/i.test(m)) return true;
  return false;
}

/** Mensagem amigável para colisão de nome único (setor duplicado). */
export function friendlySetorError(message: string): string {
  if (/duplicate key|unique/i.test(message)) {
    return "Já existe um setor com esse nome nesta empresa.";
  }
  return message;
}
