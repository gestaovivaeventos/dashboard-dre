import { cookies } from "next/headers";

export const ACTIVE_MODULE_COOKIE = "active_module";
export const ACTIVE_SEGMENT_COOKIE = "active_segment_slug";
// Filtro de empresas COMPARTILHADO entre Dashboard / Fluxo de Caixa / Budget.
// Fonte de verdade lida no SERVIDOR ao renderizar essas telas, para que a
// empresa selecionada sobreviva a navegacao sem depender de round-trip no
// cliente. O nome e duplicado em `shared-company-filter.ts` (modulo client-only,
// que nao pode importar `next/headers`) — manter os dois em sincronia.
export const ACTIVE_COMPANY_IDS_COOKIE = "active_company_ids";

export type ActiveModule = "dre" | "ctrl" | "case";

export const VALID_MODULES: readonly ActiveModule[] = ["dre", "ctrl", "case"] as const;

/**
 * Read the active module from cookies. Returns null if not set or invalid.
 * Caller decides the fallback (usually first module the user has access to).
 */
export async function readActiveModule(): Promise<ActiveModule | null> {
  const store = await cookies();
  const raw = store.get(ACTIVE_MODULE_COOKIE)?.value;
  if (!raw) return null;
  return (VALID_MODULES as readonly string[]).includes(raw) ? (raw as ActiveModule) : null;
}

/**
 * Read the active segment slug from cookies. Returns null if not set.
 * Caller is responsible for validating the slug against the user's segments.
 */
export async function readActiveSegmentSlug(): Promise<string | null> {
  const store = await cookies();
  return store.get(ACTIVE_SEGMENT_COOKIE)?.value ?? null;
}

/**
 * Le o filtro de empresas compartilhado (Dashboard/Fluxo/Budget) do cookie.
 * Retorna a lista de company ids salva pela ultima selecao do usuario, ou []
 * quando ausente. O CHAMADOR deve validar os ids contra as empresas que o
 * usuario realmente pode ver (allowedCompanyIds) — isso garante o escopo por
 * segmento e impede vazamento entre usuarios que compartilham o navegador.
 */
export async function readActiveCompanyIds(): Promise<string[]> {
  const store = await cookies();
  const raw = store.get(ACTIVE_COMPANY_IDS_COOKIE)?.value;
  if (!raw) return [];
  try {
    return decodeURIComponent(raw)
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
  } catch {
    // valor corrompido/mal-codificado — ignora e cai no default da tela
    return [];
  }
}

/**
 * Cookie options for the context cookies. 1 year expiry, lax sameSite, path=/.
 * Used by the POST /api/context route handler.
 */
export const CONTEXT_COOKIE_OPTIONS = {
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
  sameSite: "lax" as const,
  httpOnly: false, // readable from client-only code if ever needed; not sensitive
};
