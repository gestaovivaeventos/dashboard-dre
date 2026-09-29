import "server-only";

import type { SolidesDetail, SolidesListItem } from "@/lib/dp/solides/parse";

// ============================================================================
// Cliente da API da Sólides (Gestão de Pessoas). Uma conta só para todas as
// empresas do grupo, então o token é uma variável de ambiente
// (SOLIDES_API_TOKEN), não uma credencial por empresa como a da Omie.
//
// Conferido contra a API real em 29/09/2026: a lista traz só ATIVOS (nenhum
// filtro testado trouxe desligados), ~4 s para as 206 pessoas; a ficha leva
// ~0,26 s cada; nenhum cabeçalho de limite de uso.
//
// O token do Sólides DP (Tangerino — ponto/férias) é OUTRO e ainda não existe
// aqui: este token responde 401 lá.
// ============================================================================

const BASE_URL = "https://app.solides.com/pt-BR/api/v1";
const PAGE_SIZE = 150;
const TIMEOUT_MS = 30_000;

export class SolidesError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "SolidesError";
  }
}

function token(): string {
  const t = process.env.SOLIDES_API_TOKEN?.trim();
  if (!t) {
    throw new SolidesError(
      "Token da Sólides não configurado no servidor: cadastre SOLIDES_API_TOKEN nas variáveis de ambiente da Vercel e faça um novo deploy.",
    );
  }
  return t;
}

async function get<T>(path: string, attempt = 1): Promise<T> {
  // Fora do try: falta de configuração não é "Sólides indisponível" e não
  // melhora tentando de novo.
  const auth = `Token token=${token()}`;
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: { Accept: "application/json", Authorization: auth },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    if (attempt < 3) return get<T>(path, attempt + 1);
    throw new SolidesError(`Sólides indisponível: ${error instanceof Error ? error.message : String(error)}`);
  }
  // 429/5xx são passageiros; o resto (401, 404) não melhora tentando de novo.
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    await new Promise((r) => setTimeout(r, 1000 * attempt));
    return get<T>(path, attempt + 1);
  }
  if (!res.ok) {
    throw new SolidesError(
      res.status === 401 ? "Token da Sólides recusado (401)." : `Sólides respondeu HTTP ${res.status} em ${path.split("?")[0]}.`,
      res.status,
    );
  }
  return (await res.json()) as T;
}

/** Todos os colaboradores ATIVOS (paginado). */
export async function listarColaboradores(): Promise<SolidesListItem[]> {
  const out: SolidesListItem[] = [];
  for (let page = 1; page <= 200; page++) {
    const batch = await get<SolidesListItem[]>(`/colaboradores?page=${page}&page_size=${PAGE_SIZE}`);
    if (!Array.isArray(batch)) throw new SolidesError("Resposta inesperada da lista de colaboradores.");
    out.push(...batch);
    if (batch.length < PAGE_SIZE) return out;
  }
  throw new SolidesError("Lista de colaboradores não terminou em 200 páginas.");
}

export async function buscarFicha(solidesId: number): Promise<SolidesDetail> {
  return get<SolidesDetail>(`/colaboradores/${solidesId}`);
}
