const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Valida ids que entram em filtros PostgREST montados por string
 * (`.or(\`company_id.eq.${id}\`)`): um valor como `x,id.not.is.null`
 * reescreveria o filtro.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
