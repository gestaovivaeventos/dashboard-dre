import type { CtrlRole, DreRole, Segment } from "@/lib/supabase/types";
import type { ActiveModule } from "@/lib/context/active-context";
import { readActiveModule, readActiveSegmentSlug } from "@/lib/context/active-context";

export interface ModuleDefinition {
  id: ActiveModule;
  label: string;
  /** True if this module operates per-segment (controls header SegmentSelector visibility). */
  usesSegments: boolean;
  /** Default landing page when the user switches to this module. */
  defaultPath: string;
}

export const MODULES: Record<ActiveModule, ModuleDefinition> = {
  dre: {
    id: "dre",
    label: "DRE Financeiro",
    usesSegments: true,
    defaultPath: "/home",
  },
  ctrl: {
    id: "ctrl",
    label: "Controladoria",
    usesSegments: false,
    defaultPath: "/ctrl/requisicoes",
  },
};

export const MODULE_ORDER: readonly ActiveModule[] = ["dre", "ctrl"] as const;

/**
 * Returns the modules the user has any access to.
 * - DRE access if dreRole is set (always true for an authenticated app user).
 * - Ctrl access if at least one ctrlRole is non-null/non-empty.
 */
export function resolveAvailableModules(
  dreRole: DreRole | null | undefined,
  ctrlRoles: CtrlRole[] | null | undefined,
): ModuleDefinition[] {
  const result: ModuleDefinition[] = [];
  if (dreRole) result.push(MODULES.dre);
  if (ctrlRoles && ctrlRoles.length > 0) result.push(MODULES.ctrl);
  return result;
}

/**
 * Pick the active module: cookie value if present and the user has access; otherwise the first available.
 * Returns null only if the user has access to no modules (degenerate case).
 */
export function resolveActiveModule(
  cookieValue: ActiveModule | null,
  available: ModuleDefinition[],
): ModuleDefinition | null {
  if (available.length === 0) return null;
  if (cookieValue) {
    const found = available.find((m) => m.id === cookieValue);
    if (found) return found;
  }
  return available[0];
}

export interface ResolvedLayoutContext {
  availableModules: ModuleDefinition[];
  activeModule: ActiveModule;
  activeSegmentSlug: string | null;
}

/**
 * Resolves the navigation context shared by all (app) layouts.
 * Reads cookies, validates against the user's available modules and segments,
 * and applies safe fallbacks.
 *
 * @param fallbackModule Used when the cookie is missing/invalid AND no modules
 *   are available (degenerate). Different layouts default differently.
 */
export async function resolveLayoutContext(
  dreRole: DreRole | null | undefined,
  ctrlRoles: CtrlRole[] | null | undefined,
  segments: Segment[],
  fallbackModule: ActiveModule,
): Promise<ResolvedLayoutContext> {
  const availableModules = resolveAvailableModules(dreRole, ctrlRoles);
  const moduleCookie = await readActiveModule();
  const activeModuleDef = resolveActiveModule(moduleCookie, availableModules);
  const activeModule: ActiveModule = activeModuleDef?.id ?? fallbackModule;

  const segmentCookie = await readActiveSegmentSlug();
  const activeSegmentSlug =
    segmentCookie && segments.some((s) => s.slug === segmentCookie)
      ? segmentCookie
      : segments[0]?.slug ?? null;

  return { availableModules, activeModule, activeSegmentSlug };
}
