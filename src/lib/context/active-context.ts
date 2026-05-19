import { cookies } from "next/headers";

export const ACTIVE_MODULE_COOKIE = "active_module";
export const ACTIVE_SEGMENT_COOKIE = "active_segment_slug";

export type ActiveModule = "dre" | "ctrl";

export const VALID_MODULES: readonly ActiveModule[] = ["dre", "ctrl"] as const;

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
 * Cookie options for the context cookies. 1 year expiry, lax sameSite, path=/.
 * Used by the POST /api/context route handler.
 */
export const CONTEXT_COOKIE_OPTIONS = {
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
  sameSite: "lax" as const,
  httpOnly: false, // readable from client-only code if ever needed; not sensitive
};
