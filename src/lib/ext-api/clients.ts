import { timingSafeEqual } from "node:crypto";

// Sistemas externos autorizados a usar o Compras por API. A chave fica AMARRADA
// a uma empresa do Compras (org) aqui no servidor: nenhum parâmetro da chamada
// escolhe empresa, então a chave do hubfeat não alcança a Viva nem por engano.

export interface ExtApiClient {
  id: string;
  /** Variável de ambiente com a chave (Bearer). */
  keyEnv: string;
  /** Slug em ctrl_orgs da única empresa que este cliente alcança. */
  orgSlug: string;
}

export const EXT_API_CLIENTS: readonly ExtApiClient[] = [
  { id: "hubfeat", keyEnv: "HUBFEAT_API_KEY", orgSlug: "feat-producoes" },
];

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/**
 * Cliente dono do `Authorization: Bearer <chave>`, ou null. Falha fechado:
 * cliente sem a variável configurada nunca casa (chave vazia não autoriza).
 * Compara em tempo constante, como `isCronAuthorized`.
 */
export function matchExtApiClient(
  authorization: string | null,
  env: Record<string, string | undefined>,
  clients: readonly ExtApiClient[] = EXT_API_CLIENTS,
): ExtApiClient | null {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  if (!token) return null;
  for (const client of clients) {
    const key = env[client.keyEnv];
    if (key && safeEqual(token, key)) return client;
  }
  return null;
}
