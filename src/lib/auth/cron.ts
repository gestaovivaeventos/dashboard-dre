import { timingSafeEqual } from "node:crypto";

/**
 * Autoriza chamadas dos crons da Vercel (`Authorization: Bearer <CRON_SECRET>`).
 * Falha fechado sem a variável e compara em tempo constante — `===` em string
 * permite inferir o segredo byte a byte pelo tempo de resposta.
 */
export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header);
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}
