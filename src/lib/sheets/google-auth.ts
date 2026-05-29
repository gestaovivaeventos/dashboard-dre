import { createSign } from "crypto";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function loadServiceAccount(): ServiceAccount {
  const raw = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      "GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON nao configurada. Exporte o JSON do service account na variavel de ambiente.",
    );
  }
  let parsed: ServiceAccount;
  try {
    parsed = JSON.parse(raw) as ServiceAccount;
  } catch {
    throw new Error(
      "GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON nao eh JSON valido. Verifique se o conteudo nao esta com aspas / quebras escapadas em excesso.",
    );
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(
      "Service account JSON sem `client_email` ou `private_key`.",
    );
  }
  // .env serializa \n como string literal '\\n' — normaliza pra quebras reais.
  parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  return parsed;
}

function signJwt(serviceAccount: ServiceAccount): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const claim = base64url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: SCOPE,
      aud: serviceAccount.token_uri ?? TOKEN_ENDPOINT,
      exp: now + 3600,
      iat: now,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = base64url(signer.sign(serviceAccount.private_key));
  return `${unsigned}.${signature}`;
}

/**
 * Retorna um access token OAuth2 valido para a Google Sheets API,
 * com cache em memoria (~55min — token oficial expira em 1h).
 */
export async function getGoogleSheetsAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const serviceAccount = loadServiceAccount();
  const jwt = signJwt(serviceAccount);

  const response = await fetch(serviceAccount.token_uri ?? TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Falha ao obter access token Google (${response.status}): ${body}`,
    );
  }

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!payload.access_token) {
    throw new Error("Resposta do Google sem access_token.");
  }

  const ttlSeconds = payload.expires_in ?? 3600;
  cachedToken = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + ttlSeconds * 1000 - 60_000,
  };

  return cachedToken.accessToken;
}
