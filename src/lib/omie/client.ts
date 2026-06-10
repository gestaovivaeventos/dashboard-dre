// Chamador genérico da API Omie com rate-limit (350ms) e retry em 5xx/rede.
// Diferente do omieRequest privado do sync.ts, trata respostas "não
// encontrado" como resultado vazio (necessário para a busca por CNPJ).

const REQUEST_INTERVAL_MS = 350;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Rate-limit conservador por processo. Cada unidade é uma conta Omie distinta,
// então poderia ser por-conta; um global simples é suficiente aqui.
const lastRequest = { value: 0 };

export const OMIE_CLIENTES_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

// Frases que a Omie retorna em faultstring quando não há registro — NÃO são erro
// (a Omie devolve isso até com HTTP 500). Lista ampla pois o texto varia por
// chamada (ListarClientes, ConsultarCliente, etc.).
const NOT_FOUND_HINTS = [
  "não encontrado",
  "nao encontrado",
  "não existem registros",
  "nao existem registros",
  "não existem clientes",
  "nao existem clientes",
  "não foram encontrados",
  "nao foram encontrados",
  "não existe cliente",
  "nao existe cliente",
  "nenhum registro",
  "nenhum cliente",
  "not found",
];

// Faults TRANSITÓRIOS da Omie (HTTP 500 com faultstring) — devem ser re-tentadas,
// não tratadas como erro definitivo. A principal é o lock de concorrência por
// método ("Já existe uma requisição desse método sendo executada...").
const TRANSIENT_HINTS = [
  "já existe uma requisição desse método",
  "ja existe uma requisicao desse metodo",
  "tente novamente",
  "consumo redundante",
  "bloqueado por consumo",
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
      // A Omie devolve HTTP 500 com um corpo JSON de faultstring para MUITOS
      // erros de negócio — inclusive "não existem registros" no ListarClientes.
      // Por isso interpretamos o corpo antes de classificar como transiente.
      let body: Record<string, unknown> | null = null;
      try {
        body = (await response.json()) as Record<string, unknown>;
      } catch {
        body = null;
      }
      const fault = body?.faultstring ?? body?.faultcode;
      if (fault) {
        const msg = String(body?.faultstring ?? "").toLowerCase();
        if (NOT_FOUND_HINTS.some((h) => msg.includes(h))) {
          return { data: body ?? {}, notFound: true };
        }
        // Lock de concorrência / "tente novamente" → transitório: re-tenta.
        if (TRANSIENT_HINTS.some((h) => msg.includes(h)) && attempt < MAX_ATTEMPTS) {
          lastError = new Error(String(body?.faultstring ?? `Omie transitório em ${call}.`));
          await sleep(600 * 2 ** (attempt - 1));
          continue;
        }
        throw new Error(String(body?.faultstring ?? `Erro Omie em ${call}.`));
      }
      // Sem fault legível: 5xx é transiente (retry); 4xx é definitivo.
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
