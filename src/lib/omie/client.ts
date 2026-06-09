// Chamador genérico da API Omie com rate-limit (350ms) e retry em 5xx/rede.
// Diferente do omieRequest privado do sync.ts, trata respostas "não
// encontrado" como resultado vazio (necessário para a busca por CNPJ).

const REQUEST_INTERVAL_MS = 350;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Rate-limit conservador por processo. Cada unidade é uma conta Omie distinta,
// então poderia ser por-conta; um global simples é suficiente aqui.
const lastRequest = { value: 0 };

export const OMIE_CLIENTES_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

// Frases que a Omie retorna em faultstring quando não há registro — NÃO são erro.
const NOT_FOUND_HINTS = [
  "não encontrado",
  "nao encontrado",
  "não existem registros",
  "nao existem registros",
  "nenhum registro",
  "not found",
];

export interface OmieResult {
  data: Record<string, unknown>;
  notFound: boolean;
}

export async function omieCall(
  endpoint: string,
  call: string,
  appKey: string,
  appSecret: string,
  param: Record<string, unknown>,
): Promise<OmieResult> {
  const MAX_ATTEMPTS = 4;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const elapsed = Date.now() - lastRequest.value;
    if (lastRequest.value > 0 && elapsed < REQUEST_INTERVAL_MS) {
      await sleep(REQUEST_INTERVAL_MS - elapsed);
    }

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }),
        cache: "no-store",
      });
    } catch (err) {
      lastRequest.value = Date.now();
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === MAX_ATTEMPTS) throw lastError;
      await sleep(600 * 2 ** (attempt - 1));
      continue;
    }
    lastRequest.value = Date.now();

    if (!response.ok) {
      if (response.status >= 500 && attempt < MAX_ATTEMPTS) {
        lastError = new Error(`Omie HTTP ${response.status} em ${call}.`);
        await sleep(600 * 2 ** (attempt - 1));
        continue;
      }
      throw new Error(`Omie HTTP ${response.status} em ${call}.`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    const faultRaw = data.faultstring ?? data.faultcode;
    if (faultRaw) {
      const msg = String(data.faultstring ?? "").toLowerCase();
      if (NOT_FOUND_HINTS.some((h) => msg.includes(h))) {
        return { data, notFound: true };
      }
      throw new Error(String(data.faultstring ?? `Erro Omie em ${call}.`));
    }
    return { data, notFound: false };
  }

  throw lastError ?? new Error(`Falha ao chamar Omie em ${call}.`);
}
