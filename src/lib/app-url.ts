/**
 * URL canônica da aplicação, para montar links absolutos em e-mails.
 *
 * Prioriza a URL de produção do Vercel quando rodando em prod — evita o caso
 * em que NEXT_PUBLIC_APP_URL ficou apontando para localhost na production env
 * e o link do e-mail sai quebrado.
 */
export function resolveAppUrl(): string {
  if (
    process.env.VERCEL_ENV === "production" &&
    process.env.VERCEL_PROJECT_PRODUCTION_URL
  ) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
