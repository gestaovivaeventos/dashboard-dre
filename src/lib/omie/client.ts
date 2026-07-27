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

// Lock de concorrência por método ("Já existe uma requisição desse método
// sendo executada...") — clareia em 1-3s, então re-tentamos com backoff.
// NÃO inclua "tente novamente" aqui: essa frase também aparece no "consumo
// redundante" (que precisa de ~40s, tratado à parte abaixo).
const TRANSIENT_HINTS = [
  "já existe uma requisição desse método",
  "ja existe uma requisicao desse metodo",
];

// Proteção anti-duplicidade da Omie: a MESMA chamada repetida numa janela curta
// é bloqueada ("Consumo redundante detectado. Aguarde N segundos..."). Re-tentar
// rápido é inútil — surfacea uma mensagem clara e acionável.
const REDUNDANT_HINTS = ["consumo redundante", "redundant", "bloqueado por consumo"];

export interface OmieResult {
  data: Record<string, unknown>;
  notFound: boolean;
}

// Cache curtíssimo para chamadas de LEITURA idênticas (Listar*/Consultar*).
// A Omie bloqueia a MESMA chamada repetida numa janela de ~40s ("consumo
// redundante"). No envio em massa de contas a pagar, o loop repete leituras
// idênticas (ListarProjetos com params fixos; ListarContasPagar por CNPJ quando
// vários itens compartilham fornecedor), o que disparava esse bloqueio e
// derrubava a migração para o Omie. Memorizamos o resultado por uma janela um
// pouco maior que a da Omie: qualquer repetição idêntica dentro dela seria
// bloqueada de qualquer forma, então servir o resultado recente é estritamente
// melhor que falhar o lote. SÓ leituras entram no cache — escritas
// (Incluir/Alterar/Excluir) nunca, para não mascarar mudanças de estado.
const READ_CACHE_TTL_MS = 45_000;
const readCache = new Map<string, { at: number; result: OmieResult }>();

// Só chamadas de leitura ("Listar…", "Consultar…") são idempotentes e seguras
// para cachear. Escritas ficam de fora.
function isReadCall(call: string): boolean {
  return /^(Listar|Consultar)/i.test(call);
}

function readCacheKey(
  endpoint: string,
  call: string,
  appKey: string,
  param: Record<string, unknown>,
): string {
  return `${endpoint}|${call}|${appKey}|${JSON.stringify(param)}`;
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

  // Leitura idêntica recente → devolve do cache, evitando o bloqueio anti-
  // duplicidade da Omie no envio em massa. Só para Listar*/Consultar*.
  const cacheable = isReadCall(call);
  const cacheKey = cacheable ? readCacheKey(endpoint, call, appKey, param) : "";
  if (cacheable) {
    const hit = readCache.get(cacheKey);
    if (hit && Date.now() - hit.at < READ_CACHE_TTL_MS) {
      return hit.result;
    }
    if (hit) readCache.delete(cacheKey);
  }

  // Guarda o resultado de uma leitura bem-sucedida (inclusive notFound, que é um
  // desfecho válido e igualmente sujeito ao bloqueio se repetido).
  const remember = (result: OmieResult): OmieResult => {
    if (cacheable) readCache.set(cacheKey, { at: Date.now(), result });
    return result;
  };

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
          return remember({ data: body ?? {}, notFound: true });
        }
        // Consumo redundante (anti-duplicidade): não re-tenta; mensagem clara.
        if (REDUNDANT_HINTS.some((h) => msg.includes(h))) {
          throw new Error(
            "Omie bloqueou por consumo redundante (proteção contra duplicidade). Aguarde cerca de 40 segundos e tente reenviar.",
          );
        }
        // Lock de concorrência por método → transitório: re-tenta com backoff.
        if (TRANSIENT_HINTS.some((h) => msg.includes(h)) && attempt < MAX_ATTEMPTS) {
          lastError = new Error(String(body?.faultstring ?? `Omie transitório em ${call}.`));
          await sleep(800 * 2 ** (attempt - 1));
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
        return remember({ data, notFound: true });
      }
      throw new Error(String(data.faultstring ?? `Erro Omie em ${call}.`));
    }
    return remember({ data, notFound: false });
  }

  throw lastError ?? new Error(`Falha ao chamar Omie em ${call}.`);
}
