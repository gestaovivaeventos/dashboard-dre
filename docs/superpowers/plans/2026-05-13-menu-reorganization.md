# Menu Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the app navigation so module (DRE/Ctrl) and segment are global header context; the sidebar shows only the active module's pages, split into a daily-use block and an "Administração" block.

**Architecture:** Two cookies (`active_module`, `active_segment_slug`) drive the navigation context, read in the `(app)` server layout and written by a single `/api/context` POST endpoint. A new `ModuleSwitcher` and `SegmentSelector` live in the header; `NavLinks` is refactored to render two role-filtered blocks per module without the per-segment accordion. Global routes `/mapeamento` and `/configuracoes` are removed in favor of the per-segment variants.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind, shadcn/ui primitives (Select, Sheet, Tooltip, Button, Input), Radix Select, `next/headers` cookies. No test framework — verification is `npm run lint` + `npm run build` + manual smoke.

**Spec:** [docs/superpowers/specs/2026-05-13-menu-reorganization-design.md](../specs/2026-05-13-menu-reorganization-design.md)

---

## Conventions for this plan

- **Verification per task:** every task ends with `npm run lint && npm run build` and (where UI changes) a brief manual smoke step you execute with `npm run dev`.
- **Commits:** one per task minimum; conventional commits (`feat(nav): ...`, `refactor(nav): ...`).
- **Portuguese for user-facing text; English for technical/debug** (CLAUDE.md convention).
- **Path aliases:** `@/*` → `./src/*`.

---

## File Structure

**New files:**

- `src/lib/context/active-context.ts` — server-side cookie readers for `active_module` and `active_segment_slug`.
- `src/lib/context/modules.ts` — module definitions, available-modules resolver based on user roles.
- `src/app/api/context/route.ts` — POST endpoint to write context cookies.
- `src/components/app/module-switcher.tsx` — header dropdown for module selection (uses shadcn Select).
- `src/components/app/segment-selector.tsx` — header dropdown for segment selection (custom small popover with optional search filter when ≥6 segments).
- `src/components/app/notifications-link.tsx` — small icon link to `/ctrl/notificacoes` in header.

**Modified files:**

- `src/components/app/navigation.ts` — split items into `DRE_DAILY_ITEMS` / `DRE_ADMIN_ITEMS` / `CTRL_DAILY_ITEMS` / `CTRL_ADMIN_ITEMS`.
- `src/components/app/nav-links.tsx` — accept `activeModule` prop; render two blocks (daily + admin) for the active module; remove per-segment accordion.
- `src/components/app/app-shell.tsx` — accept module/segment context; render ModuleSwitcher, SegmentSelector, NotificationsLink in header; pass `activeModule` to NavLinks.
- `src/app/(app)/layout.tsx` — read cookies, resolve `activeModule`/`activeSegment`/`availableModules`, pass to AppShell.
- `src/lib/auth/access.ts` — remove `/mapeamento` and `/configuracoes` from `DRE_RULES` (keep only `SEGMENT_SUB_RULES` variants).

**Files to delete (if they exist as top-level pages):**

- `src/app/(app)/mapeamento/page.tsx`
- `src/app/(app)/configuracoes/page.tsx`

These are replaced by the per-segment routes at `src/app/(app)/s/[slug]/mapeamento/page.tsx` and `.../configuracoes/page.tsx` (verify these already exist; if not, the deletion is deferred).

---

## Task 1: Active context cookie helpers (server-only)

**Files:**
- Create: `src/lib/context/active-context.ts`

- [ ] **Step 1: Create the cookie reader module**

Create `src/lib/context/active-context.ts` with the following content:

```ts
import { cookies } from "next/headers";

export const ACTIVE_MODULE_COOKIE = "active_module";
export const ACTIVE_SEGMENT_COOKIE = "active_segment_slug";

export type ActiveModule = "dre" | "ctrl";

const VALID_MODULES: readonly ActiveModule[] = ["dre", "ctrl"] as const;

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
```

- [ ] **Step 2: Verify build**

Run: `npm run lint && npm run build`
Expected: PASS with no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/context/active-context.ts
git commit -m "feat(context): add cookie helpers for active module and segment"
```

---

## Task 2: Module definitions and available-modules resolver

**Files:**
- Create: `src/lib/context/modules.ts`

- [ ] **Step 1: Create the module definitions module**

Create `src/lib/context/modules.ts` with the following content:

```ts
import type { CtrlRole, DreRole } from "@/lib/supabase/types";
import type { ActiveModule } from "@/lib/context/active-context";

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
```

- [ ] **Step 2: Verify build**

Run: `npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/context/modules.ts
git commit -m "feat(context): define modules and resolver for available/active module"
```

---

## Task 3: POST /api/context endpoint

**Files:**
- Create: `src/app/api/context/route.ts`

- [ ] **Step 1: Create the route handler**

Create `src/app/api/context/route.ts` with the following content:

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import {
  ACTIVE_MODULE_COOKIE,
  ACTIVE_SEGMENT_COOKIE,
  CONTEXT_COOKIE_OPTIONS,
} from "@/lib/context/active-context";

interface ContextUpdateBody {
  module?: "dre" | "ctrl";
  segmentSlug?: string;
}

const VALID_MODULES = new Set(["dre", "ctrl"]);

export async function POST(request: Request) {
  let body: ContextUpdateBody;
  try {
    body = (await request.json()) as ContextUpdateBody;
  } catch {
    return NextResponse.json({ error: "Corpo invalido" }, { status: 400 });
  }

  const store = await cookies();

  if (body.module !== undefined) {
    if (!VALID_MODULES.has(body.module)) {
      return NextResponse.json({ error: "Modulo invalido" }, { status: 400 });
    }
    store.set(ACTIVE_MODULE_COOKIE, body.module, CONTEXT_COOKIE_OPTIONS);
  }

  if (body.segmentSlug !== undefined) {
    if (typeof body.segmentSlug !== "string" || body.segmentSlug.length === 0 || body.segmentSlug.length > 64) {
      return NextResponse.json({ error: "Slug de segmento invalido" }, { status: 400 });
    }
    store.set(ACTIVE_SEGMENT_COOKIE, body.segmentSlug, CONTEXT_COOKIE_OPTIONS);
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Verify build**

Run: `npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 3: Manual smoke test**

Start dev server: `npm run dev`

In a second terminal, log in via the browser (so you have a session cookie), then from the same browser's dev tools console run:

```js
fetch("/api/context", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ module: "dre", segmentSlug: "test-slug" }),
}).then((r) => r.json()).then(console.log)
```

Expected: `{ ok: true }`. In Application → Cookies, verify `active_module=dre` and `active_segment_slug=test-slug` are set with path `/`.

Then test invalid payload:

```js
fetch("/api/context", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ module: "invalid" }),
}).then((r) => r.json()).then(console.log)
```

Expected: `{ error: "Modulo invalido" }` with status 400.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/context/route.ts
git commit -m "feat(api): add POST /api/context to set module/segment cookies"
```

---

## Task 4: Split navigation items into daily/admin per module

**Files:**
- Modify: `src/components/app/navigation.ts`

- [ ] **Step 1: Replace the file contents**

Open `src/components/app/navigation.ts` and replace the entire file with:

```ts
import {
  BarChart3,
  Bell,
  Brain,
  Calendar,
  CheckSquare,
  Cog,
  DollarSign,
  FileText,
  MapPinned,
  PieChart,
  Receipt,
  Settings,
  Target,
  Truck,
  Users,
  Wallet,
} from "lucide-react";

import type { CtrlRole, DreRole } from "@/lib/supabase/types";

/**
 * DRE module items rendered per active segment.
 * The href is built at render time as `/s/<active-slug><suffix>`.
 */
export const DRE_SEGMENT_DAILY_ITEMS = [
  {
    title: "Dashboard",
    suffix: "/dashboard",
    icon: PieChart,
    roles: ["admin", "gestor_hero", "gestor_unidade"] as DreRole[],
  },
  {
    title: "Fluxo de Caixa",
    suffix: "/fluxo-de-caixa",
    icon: Wallet,
    roles: ["admin", "gestor_hero", "gestor_unidade"] as DreRole[],
  },
  {
    title: "Budget e Forecast",
    suffix: "/budget-forecast",
    icon: Target,
    roles: ["admin", "gestor_hero", "gestor_unidade"] as DreRole[],
  },
  {
    title: "KPIs",
    suffix: "/kpis",
    icon: BarChart3,
    roles: ["admin", "gestor_hero", "gestor_unidade"] as DreRole[],
  },
] as const;

export const DRE_SEGMENT_ADMIN_ITEMS = [
  {
    title: "Mapeamento",
    suffix: "/mapeamento",
    icon: MapPinned,
    roles: ["admin"] as DreRole[],
  },
  {
    title: "Configuracoes",
    suffix: "/configuracoes",
    icon: Cog,
    roles: ["admin"] as DreRole[],
  },
] as const;

/**
 * DRE module items that are cross-segment (global routes, no /s/<slug> prefix).
 */
export const DRE_GLOBAL_ADMIN_ITEMS = [
  {
    title: "Conexoes",
    href: "/conexoes",
    icon: Settings,
    roles: ["admin", "gestor_hero"] as DreRole[],
  },
  {
    title: "Usuarios",
    href: "/usuarios",
    icon: Users,
    roles: ["admin"] as DreRole[],
  },
  {
    title: "Inteligencia",
    href: "/admin/inteligencia",
    icon: Brain,
    roles: ["admin"] as DreRole[],
  },
  {
    title: "Painel Administrador",
    href: "/admin",
    icon: Settings,
    roles: ["admin"] as DreRole[],
  },
] as const;

/**
 * Controladoria module items — daily use (top of sidebar).
 */
export const CTRL_DAILY_ITEMS = [
  {
    title: "Requisicoes",
    href: "/ctrl/requisicoes",
    icon: FileText,
    roles: ["solicitante", "gerente", "diretor", "csc", "contas_a_pagar", "admin"] as CtrlRole[],
  },
  {
    title: "Aprovacoes",
    href: "/ctrl/aprovacoes",
    icon: CheckSquare,
    roles: ["gerente", "diretor", "csc", "contas_a_pagar", "admin"] as CtrlRole[],
  },
  {
    title: "Contas a Pagar",
    href: "/ctrl/contas-a-pagar",
    icon: Receipt,
    roles: ["gerente", "diretor", "csc", "contas_a_pagar", "admin"] as CtrlRole[],
  },
  {
    title: "Orcamento",
    href: "/ctrl/orcamento",
    icon: DollarSign,
    roles: ["gerente", "diretor", "csc", "admin"] as CtrlRole[],
  },
  {
    title: "Relatorios",
    href: "/ctrl/relatorios",
    icon: BarChart3,
    roles: ["gerente", "diretor", "csc", "contas_a_pagar", "admin"] as CtrlRole[],
  },
  {
    title: "Notificacoes",
    href: "/ctrl/notificacoes",
    icon: Bell,
    roles: ["solicitante", "gerente", "diretor", "csc", "contas_a_pagar", "admin"] as CtrlRole[],
  },
] as const;

/**
 * Controladoria module items — admin (bottom of sidebar).
 */
export const CTRL_ADMIN_ITEMS = [
  {
    title: "Fornecedores",
    href: "/ctrl/admin/fornecedores",
    icon: Truck,
    roles: ["csc", "admin", "aprovacao_fornecedor"] as CtrlRole[],
  },
  {
    title: "Eventos",
    href: "/ctrl/admin/eventos",
    icon: Calendar,
    roles: ["csc", "admin"] as CtrlRole[],
  },
] as const;
```

Note: this REMOVES the old `SEGMENT_SUB_ITEMS`, `GLOBAL_NAV_ITEMS`, and `CTRL_NAV_ITEMS` exports. `nav-links.tsx` will be updated in Task 5 to use the new shape.

- [ ] **Step 2: Verify build (expect failure in nav-links.tsx)**

Run: `npm run build`
Expected: FAIL with TypeScript errors in `nav-links.tsx` for missing imports `SEGMENT_SUB_ITEMS`, `GLOBAL_NAV_ITEMS`, `CTRL_NAV_ITEMS`. This is expected — Task 5 fixes it.

Do **not** commit yet. Continue to Task 5.

---

## Task 5: Refactor nav-links.tsx — two-block layout per active module

**Files:**
- Modify: `src/components/app/nav-links.tsx` (full rewrite)

- [ ] **Step 1: Replace the file contents**

Open `src/components/app/nav-links.tsx` and replace the entire file with:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  CTRL_ADMIN_ITEMS,
  CTRL_DAILY_ITEMS,
  DRE_GLOBAL_ADMIN_ITEMS,
  DRE_SEGMENT_ADMIN_ITEMS,
  DRE_SEGMENT_DAILY_ITEMS,
} from "@/components/app/navigation";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ActiveModule } from "@/lib/context/active-context";
import type { CtrlRole, DreRole, Segment } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

interface NavLinksProps {
  activeModule: ActiveModule;
  role: DreRole;
  ctrlRoles?: CtrlRole[];
  segments: Segment[];
  activeSegmentSlug: string | null;
  collapsed?: boolean;
  onNavigate?: () => void;
}

interface RenderItem {
  key: string;
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

export function NavLinks({
  activeModule,
  role,
  ctrlRoles,
  segments,
  activeSegmentSlug,
  collapsed,
  onNavigate,
}: NavLinksProps) {
  const pathname = usePathname();

  const { daily, admin } = buildItems({
    activeModule,
    role,
    ctrlRoles,
    segments,
    activeSegmentSlug,
  });

  const renderItem = (item: RenderItem) => {
    const Icon = item.icon;
    const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

    const baseLink = (
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          collapsed
            ? "flex h-10 w-full items-center justify-center rounded-lg transition-colors"
            : "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
          isActive
            ? "bg-viva-500 text-white"
            : "text-ink-secondary hover:bg-surface-2 hover:text-ink-primary",
        )}
      >
        <Icon className={collapsed ? "h-4 w-4" : "h-4 w-4"} />
        {!collapsed && <span>{item.title}</span>}
      </Link>
    );

    if (!collapsed) return <div key={item.key}>{baseLink}</div>;

    return (
      <Tooltip key={item.key}>
        <TooltipTrigger asChild>{baseLink}</TooltipTrigger>
        <TooltipContent side="right">{item.title}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <nav className="space-y-1">
      {daily.map(renderItem)}

      {admin.length > 0 && (
        <>
          <div className="my-3 border-t border-border" />
          {!collapsed && (
            <div className="t-label mb-1 px-3 py-1 text-ink-muted/80">ADMINISTRAÇÃO</div>
          )}
          {admin.map(renderItem)}
        </>
      )}
    </nav>
  );
}

interface BuildItemsInput {
  activeModule: ActiveModule;
  role: DreRole;
  ctrlRoles?: CtrlRole[];
  segments: Segment[];
  activeSegmentSlug: string | null;
}

function buildItems({
  activeModule,
  role,
  ctrlRoles,
  segments,
  activeSegmentSlug,
}: BuildItemsInput): { daily: RenderItem[]; admin: RenderItem[] } {
  if (activeModule === "dre") {
    const slug =
      activeSegmentSlug && segments.some((s) => s.slug === activeSegmentSlug)
        ? activeSegmentSlug
        : segments[0]?.slug ?? null;

    const daily: RenderItem[] = slug
      ? DRE_SEGMENT_DAILY_ITEMS.filter((i) => i.roles.includes(role)).map((i) => ({
          key: `dre-seg-daily-${i.suffix}`,
          title: i.title,
          href: `/s/${slug}${i.suffix}`,
          icon: i.icon,
        }))
      : [];

    const segmentAdmin: RenderItem[] = slug
      ? DRE_SEGMENT_ADMIN_ITEMS.filter((i) => i.roles.includes(role)).map((i) => ({
          key: `dre-seg-admin-${i.suffix}`,
          title: i.title,
          href: `/s/${slug}${i.suffix}`,
          icon: i.icon,
        }))
      : [];

    const globalAdmin: RenderItem[] = DRE_GLOBAL_ADMIN_ITEMS.filter((i) => i.roles.includes(role)).map(
      (i) => ({
        key: `dre-global-${i.href}`,
        title: i.title,
        href: i.href,
        icon: i.icon,
      }),
    );

    return { daily, admin: [...segmentAdmin, ...globalAdmin] };
  }

  // Controladoria
  const ctrlSet = new Set(ctrlRoles ?? []);
  const matches = <T extends { roles: readonly CtrlRole[] }>(item: T) =>
    item.roles.some((r) => ctrlSet.has(r));

  const daily: RenderItem[] = CTRL_DAILY_ITEMS.filter(matches).map((i) => ({
    key: `ctrl-daily-${i.href}`,
    title: i.title,
    href: i.href,
    icon: i.icon,
  }));

  const admin: RenderItem[] = CTRL_ADMIN_ITEMS.filter(matches).map((i) => ({
    key: `ctrl-admin-${i.href}`,
    title: i.title,
    href: i.href,
    icon: i.icon,
  }));

  return { daily, admin };
}
```

- [ ] **Step 2: Verify build (still expect failure in app-shell.tsx)**

Run: `npm run build`
Expected: FAIL with TypeScript error in `app-shell.tsx` — `NavLinks` now requires `activeModule` and `activeSegmentSlug` props it isn't passing yet. Tasks 6–8 fix this. Do not commit yet.

---

## Task 6: ModuleSwitcher component

**Files:**
- Create: `src/components/app/module-switcher.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/app/module-switcher.tsx` with:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ActiveModule } from "@/lib/context/active-context";
import type { ModuleDefinition } from "@/lib/context/modules";

interface ModuleSwitcherProps {
  active: ActiveModule;
  available: ModuleDefinition[];
}

export function ModuleSwitcher({ active, available }: ModuleSwitcherProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Single-module users see a static label, no dropdown.
  if (available.length <= 1) {
    const only = available[0];
    if (!only) return null;
    return (
      <span className="t-label hidden text-ink-muted md:inline">{only.label}</span>
    );
  }

  const onChange = (next: string) => {
    if (next === active) return;
    const target = available.find((m) => m.id === next);
    if (!target) return;

    startTransition(async () => {
      await fetch("/api/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module: target.id }),
      });
      router.push(target.defaultPath);
      router.refresh();
    });
  };

  return (
    <Select value={active} onValueChange={onChange} disabled={pending}>
      <SelectTrigger className="h-9 w-[180px]" aria-label="Modulo ativo">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {available.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 2: Verify build (still expect failure in app-shell.tsx)**

Run: `npm run build`
Expected: Still failing on app-shell.tsx (no integration yet). The new file itself should type-check. Do not commit yet.

---

## Task 7: SegmentSelector component (with search when ≥6 segments)

**Files:**
- Create: `src/components/app/segment-selector.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/app/segment-selector.tsx` with:

```tsx
"use client";

import { Check, ChevronsUpDown, Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Segment } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

interface SegmentSelectorProps {
  segments: Segment[];
  activeSlug: string | null;
}

const SEARCH_THRESHOLD = 6;

export function SegmentSelector({ segments, activeSlug }: SegmentSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Empty state
  if (segments.length === 0) {
    return (
      <span className="text-xs text-ink-muted">
        Sem segmentos disponiveis — fale com um admin
      </span>
    );
  }

  const activeSegment =
    segments.find((s) => s.slug === activeSlug) ?? segments[0];

  // Single segment — static label
  if (segments.length === 1) {
    return <span className="t-label text-ink-secondary">{activeSegment.name}</span>;
  }

  const filtered =
    segments.length >= SEARCH_THRESHOLD && query.trim().length > 0
      ? segments.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()))
      : segments;

  const onPick = (slug: string) => {
    if (slug === activeSegment.slug) {
      setOpen(false);
      return;
    }

    startTransition(async () => {
      await fetch("/api/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segmentSlug: slug }),
      });

      // If currently on a /s/<old>/<page> route, swap the slug in place.
      const match = pathname.match(/^\/s\/([^/]+)(\/.*)?$/);
      if (match) {
        const tail = match[2] ?? "";
        router.push(`/s/${slug}${tail}`);
      } else {
        // Global route — just refresh server components with new cookie context.
        router.refresh();
      }
      setOpen(false);
      setQuery("");
    });
  };

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        className="h-9 min-w-[180px] justify-between gap-2"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate text-sm">{activeSegment.name}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-60" />
      </Button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-40 mt-1 w-[260px] rounded-lg border border-border bg-surface-1 shadow-lg"
        >
          {segments.length >= SEARCH_THRESHOLD && (
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Search className="h-4 w-4 text-ink-muted" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar segmento…"
                className="h-7 border-0 px-0 focus-visible:ring-0"
                autoFocus
              />
            </div>
          )}
          <ul className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-ink-muted">Nenhum segmento encontrado.</li>
            ) : (
              filtered.map((s) => {
                const isActive = s.slug === activeSegment.slug;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => onPick(s.slug)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors",
                        isActive
                          ? "bg-surface-2 text-ink-primary"
                          : "text-ink-secondary hover:bg-surface-2 hover:text-ink-primary",
                      )}
                      role="option"
                      aria-selected={isActive}
                    >
                      <span className="truncate">{s.name}</span>
                      {isActive && <Check className="h-4 w-4 text-viva-500" />}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build (still expect failure in app-shell.tsx)**

Run: `npm run build`
Expected: SegmentSelector type-checks. app-shell.tsx still failing. Do not commit yet.

---

## Task 8: Notifications shortcut in header

**Files:**
- Create: `src/components/app/notifications-link.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/app/notifications-link.tsx` with:

```tsx
"use client";

import { Bell } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

interface NotificationsLinkProps {
  /** Show only if user has access to the Ctrl module. */
  visible: boolean;
}

export function NotificationsLink({ visible }: NotificationsLinkProps) {
  if (!visible) return null;
  return (
    <Button type="button" variant="outline" size="icon" asChild title="Notificacoes">
      <Link href="/ctrl/notificacoes" aria-label="Notificacoes">
        <Bell className="h-5 w-5" />
      </Link>
    </Button>
  );
}
```

> Badge with unread count is out of scope for this plan (requires a count query) — track as future enhancement.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Still failing on app-shell.tsx integration only.

---

## Task 9: Wire AppShell — new header + activeModule passed to NavLinks

**Files:**
- Modify: `src/components/app/app-shell.tsx` (full rewrite of imports + JSX)

- [ ] **Step 1: Replace the file contents**

Open `src/components/app/app-shell.tsx` and replace with:

```tsx
"use client";

import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useState } from "react";

import { Logo, LogoFull } from "@/components/app/logo";
import { ModuleSwitcher } from "@/components/app/module-switcher";
import { NavLinks } from "@/components/app/nav-links";
import { NotificationsLink } from "@/components/app/notifications-link";
import { SegmentSelector } from "@/components/app/segment-selector";
import { SignOutButton } from "@/components/app/sign-out-button";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ActiveModule } from "@/lib/context/active-context";
import type { ModuleDefinition } from "@/lib/context/modules";
import type { CtrlRole, DreRole, Segment } from "@/lib/supabase/types";

interface AppShellProps {
  children: React.ReactNode;
  userName: string;
  userEmail: string;
  userRole: DreRole;
  ctrlRoles?: CtrlRole[];
  segments: Segment[];
  activeModule: ActiveModule;
  availableModules: ModuleDefinition[];
  activeSegmentSlug: string | null;
}

export function AppShell({
  children,
  userName,
  userEmail,
  userRole,
  ctrlRoles,
  segments,
  activeModule,
  availableModules,
  activeSegmentSlug,
}: AppShellProps) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const hasCtrl = (ctrlRoles?.length ?? 0) > 0;
  const showSegmentSelector =
    activeModule === "dre" && availableModules.some((m) => m.id === "dre");

  const sidebarNav = (mobile: boolean) => (
    <NavLinks
      activeModule={activeModule}
      role={userRole}
      ctrlRoles={ctrlRoles}
      segments={segments}
      activeSegmentSlug={activeSegmentSlug}
      collapsed={!mobile && collapsed}
      onNavigate={mobile ? () => setOpen(false) : undefined}
    />
  );

  return (
    <TooltipProvider delayDuration={0}>
      <div className="min-h-screen bg-surface-0">
        {/* Desktop sidebar */}
        <aside
          className={`fixed inset-y-0 left-0 z-20 hidden flex-col border-r border-border bg-surface-1 transition-all duration-300 md:flex ${
            collapsed ? "w-16" : "w-72"
          }`}
        >
          <a href="/home" className={`flex items-center p-4 ${collapsed ? "justify-center" : ""}`}>
            {collapsed ? <Logo size={32} /> : <LogoFull />}
          </a>

          <div className="flex-1 overflow-y-auto px-2">{sidebarNav(false)}</div>

          <div className="border-t border-border p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCollapsed(!collapsed)}
              className={`w-full text-ink-secondary hover:text-ink-primary ${
                collapsed ? "justify-center px-0" : "justify-start gap-2"
              }`}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <>
                  <PanelLeftClose className="h-4 w-4" />
                  <span className="text-xs">Recolher menu</span>
                </>
              )}
            </Button>
          </div>
        </aside>

        <div className={`transition-all duration-300 ${collapsed ? "md:pl-16" : "md:pl-72"}`}>
          <header className="sticky top-0 z-30 flex h-[68px] items-center gap-3 border-b-2 border-viva-500 bg-surface-1 px-4 md:px-6">
            {/* Mobile menu trigger */}
            <div className="flex items-center gap-3 md:hidden">
              <Sheet open={open} onOpenChange={setOpen}>
                <SheetTrigger asChild>
                  <Button type="button" variant="outline" size="icon">
                    <Menu className="h-5 w-5" />
                    <span className="sr-only">Abrir menu</span>
                  </Button>
                </SheetTrigger>
                <SheetContent className="bg-surface-1">
                  <a href="/home" className="mb-6 block">
                    <LogoFull />
                  </a>

                  {/* Selectors at top of drawer */}
                  <div className="mb-4 space-y-2">
                    <ModuleSwitcher active={activeModule} available={availableModules} />
                    {showSegmentSelector && (
                      <SegmentSelector segments={segments} activeSlug={activeSegmentSlug} />
                    )}
                  </div>

                  {sidebarNav(true)}
                </SheetContent>
              </Sheet>
            </div>

            {/* Desktop selectors */}
            <div className="hidden items-center gap-3 md:flex">
              <ModuleSwitcher active={activeModule} available={availableModules} />
              {showSegmentSelector && (
                <SegmentSelector segments={segments} activeSlug={activeSegmentSlug} />
              )}
            </div>

            <div className="ml-auto flex items-center gap-3">
              <div className="hidden text-right md:block">
                <p className="text-sm font-medium leading-none text-ink-primary">{userName}</p>
                <p className="text-xs text-ink-muted">{userEmail}</p>
              </div>
              <NotificationsLink visible={hasCtrl} />
              <ThemeToggle />
              <Separator className="hidden h-8 w-px bg-white/10 sm:block" />
              <SignOutButton />
            </div>
          </header>

          <main className="p-4 md:p-6">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}
```

Notable changes from the previous AppShell:
- Removed the static "Controll Hub" label (replaced by selectors).
- Added `ModuleSwitcher`, `SegmentSelector`, `NotificationsLink` to the header.
- Mobile drawer now contains both selectors at the top before the nav.

- [ ] **Step 2: Verify build (still expect failure in layout.tsx)**

Run: `npm run build`
Expected: `app-shell.tsx` type-checks. `src/app/(app)/layout.tsx` now fails because it doesn't pass the new required props. Task 10 fixes this. Do not commit yet.

---

## Task 10: Wire (app)/layout.tsx — read cookies, resolve context, pass to AppShell

**Files:**
- Modify: `src/app/(app)/layout.tsx`

- [ ] **Step 1: Replace the file contents**

Open `src/app/(app)/layout.tsx` and replace with:

```tsx
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app/app-shell";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { readActiveModule, readActiveSegmentSlug } from "@/lib/context/active-context";
import { resolveActiveModule, resolveAvailableModules } from "@/lib/context/modules";
import type { Segment } from "@/lib/supabase/types";

export default async function ProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { supabase, user, profile, modules } = await getCurrentSessionContext();

  if (!user) {
    redirect("/login");
  }

  const userName = profile?.name || user.email || "Usuario";
  const userEmail = profile?.email || user.email || "";
  const userRole = modules?.dre?.role ?? profile?.role ?? "gestor_unidade";
  const ctrlRoles = modules?.ctrl?.roles ?? [];

  // Fetch segments the user has access to.
  let segments: Segment[] = [];
  if (userRole === "admin") {
    const { data } = await supabase
      .from("segments")
      .select("id,name,slug,display_order,active")
      .eq("active", true)
      .order("display_order");
    segments = (data as Segment[]) ?? [];
  } else if (profile) {
    const { data } = await supabase
      .from("user_segment_access")
      .select("segments(id,name,slug,display_order,active)")
      .eq("user_id", profile.id);
    segments = ((data ?? []) as unknown as Array<{ segments: Segment }>)
      .map((row) => row.segments)
      .filter((s) => s && s.active)
      .sort((a, b) => a.display_order - b.display_order);
  }

  // Resolve module/segment context.
  const availableModules = resolveAvailableModules(userRole, ctrlRoles);
  const moduleCookie = await readActiveModule();
  const activeModuleDef = resolveActiveModule(moduleCookie, availableModules);
  const activeModule = activeModuleDef?.id ?? "dre";

  const segmentCookie = await readActiveSegmentSlug();
  const activeSegmentSlug =
    segmentCookie && segments.some((s) => s.slug === segmentCookie)
      ? segmentCookie
      : segments[0]?.slug ?? null;

  return (
    <AppShell
      userName={userName}
      userEmail={userEmail}
      userRole={userRole}
      ctrlRoles={ctrlRoles}
      segments={segments}
      activeModule={activeModule}
      availableModules={availableModules}
      activeSegmentSlug={activeSegmentSlug}
    >
      {children}
    </AppShell>
  );
}
```

- [ ] **Step 2: Verify build (expect success)**

Run: `npm run lint && npm run build`
Expected: PASS. All type errors from the previous tasks should be resolved.

- [ ] **Step 3: Manual smoke test — desktop**

Run `npm run dev` and log in as an admin user with multiple segments.

Verify:
- Header shows: `[Logo] [Modulo ▾: DRE Financeiro] [Segmento ▾: <first segment>]`. To the right: avatar info, Bell icon (since admin also has Ctrl roles), theme toggle, sign out.
- Sidebar shows a top block (Dashboard / Fluxo de Caixa / Budget e Forecast / KPIs) and below a divider with "ADMINISTRAÇÃO" label the admin items (Mapeamento, Configurações, Conexões, Usuários, Inteligência, Painel Administrador).
- Click Dashboard → URL is `/s/<active-slug>/dashboard`. Page renders.
- Open the segment selector → if you have <6 segments, no search box; if ≥6, search box appears at the top. Pick a different segment.
- URL should change to `/s/<new-slug>/dashboard` (same page, new slug). Page re-renders for the new segment.
- Click the module switcher → choose "Controladoria". URL navigates to `/ctrl/requisicoes`. Sidebar now shows Ctrl items (Requisições, Aprovações, Contas a Pagar, Orçamento, Relatórios, Notificações), and below the divider: Fornecedores, Eventos. Segment selector is hidden from the header.

- [ ] **Step 4: Manual smoke test — mobile**

Resize to <768px width (or use device emulation).

Verify:
- Header shows hamburger button + (no static label) + bell/theme/signout on the right.
- Tap hamburger → drawer opens. Top of drawer: module switcher + segment selector (when in DRE). Below: the nav (same two-block layout, no collapsed mode).
- Pick a sidebar item → drawer closes, page navigates.

- [ ] **Step 5: Manual smoke test — degraded roles**

If possible (or via a second account), log in as a `gestor_unidade` user with one segment:

Verify:
- Header: no module switcher (only DRE available → static label `DRE Financeiro` visible on md+ screens; on small screens it's hidden as noted in `ModuleSwitcher` empty-state).
- Segment selector: if exactly 1 segment, it shows as a static label, not a dropdown.
- Sidebar: only the 4 daily items (Dashboard, Fluxo de Caixa, Budget, KPIs). No divider, no "ADMINISTRAÇÃO" label, no admin items.

Stop the dev server.

- [ ] **Step 6: Commit (the full feature)**

```bash
git add src/lib/context/active-context.ts src/lib/context/modules.ts src/app/api/context/route.ts \
  src/components/app/navigation.ts src/components/app/nav-links.tsx \
  src/components/app/module-switcher.tsx src/components/app/segment-selector.tsx \
  src/components/app/notifications-link.tsx src/components/app/app-shell.tsx \
  src/app/(app)/layout.tsx
git commit -m "feat(nav): module switcher and global segment context in header; sidebar split into daily/admin blocks"
```

> Note: tasks 4–10 produce one logical change that must land together to keep the app building. They're grouped under this single feature commit; if you've been committing incrementally where each compiled, prefer those individual commits instead.

---

## Task 11: Remove duplicate global `/mapeamento` and `/configuracoes` routes

**Files:**
- Modify: `src/lib/auth/access.ts`
- Possibly delete: `src/app/(app)/mapeamento/page.tsx`, `src/app/(app)/configuracoes/page.tsx` (if present as top-level pages)
- Possibly create redirect: `src/app/(app)/mapeamento/page.tsx` (replace with redirect to active segment)

- [ ] **Step 1: Inspect what exists today**

Run:

```bash
ls src/app/(app)/mapeamento 2>/dev/null
ls src/app/(app)/configuracoes 2>/dev/null
ls src/app/(app)/s/[slug]/mapeamento 2>/dev/null
ls src/app/(app)/s/[slug]/configuracoes 2>/dev/null
```

Record which of the two forms exist. The spec requires the per-segment variant to be the canonical one.

- [ ] **Step 2: Decision — choose Option A or Option B**

**Option A (recommended): Delete the global page files.**

If both `src/app/(app)/mapeamento/page.tsx` AND `src/app/(app)/s/[slug]/mapeamento/page.tsx` exist (and similarly for configuracoes), the per-segment versions are the source of truth. Delete the global pages:

```bash
git rm src/app/(app)/mapeamento/page.tsx
git rm src/app/(app)/configuracoes/page.tsx
```

If only the global versions exist (no per-segment), STOP and surface this to the user — moving the page to `/s/[slug]/...` is a separate change that's outside this plan's scope.

**Option B: Replace globals with a server-side redirect.**

If you want `/mapeamento` URLs in user bookmarks to keep working, replace the global page with a redirect to the per-segment one. Create `src/app/(app)/mapeamento/page.tsx`:

```tsx
import { redirect } from "next/navigation";

import { readActiveSegmentSlug } from "@/lib/context/active-context";

export default async function MapeamentoRedirect() {
  const slug = await readActiveSegmentSlug();
  redirect(slug ? `/s/${slug}/mapeamento` : "/home");
}
```

Do the same for `configuracoes`. This is the safer choice if you're unsure whether external links to `/mapeamento` exist.

Pick A or B based on Step 1 findings. The remaining steps assume Option A; for Option B, skip the deletion and create the redirect files instead.

- [ ] **Step 3: Update `access.ts`**

In `src/lib/auth/access.ts`, remove the two entries from `DRE_RULES`:

```ts
{ prefix: "/mapeamento",       roles: ["admin"] },
{ prefix: "/configuracoes",    roles: ["admin"] },
```

After the edit, `DRE_RULES` should contain only:

```ts
const DRE_RULES: Array<{ prefix: string; roles: DreRole[] }> = [
  { prefix: "/admin",            roles: ["admin"] },
  { prefix: "/usuarios",         roles: ["admin"] },
  { prefix: "/dashboard",        roles: ["admin", "gestor_hero", "gestor_unidade"] },
  { prefix: "/fluxo-de-caixa",   roles: ["admin", "gestor_hero", "gestor_unidade"] },
  { prefix: "/budget-forecast",  roles: ["admin", "gestor_hero", "gestor_unidade"] },
  { prefix: "/kpis",             roles: ["admin", "gestor_hero", "gestor_unidade"] },
  { prefix: "/conexoes",         roles: ["admin", "gestor_hero"] },
];
```

`SEGMENT_SUB_RULES` keeps the `/mapeamento` and `/configuracoes` entries as-is — they still apply under `/s/<slug>/...`.

- [ ] **Step 4: Verify build**

Run: `npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 5: Manual smoke test**

Run `npm run dev`. As an admin:

- Navigate to `/s/<slug>/mapeamento` → page loads.
- Navigate to `/mapeamento`:
  - Option A: 404.
  - Option B: redirects to `/s/<active-slug>/mapeamento`.
- Sidebar's "Mapeamento" item points to `/s/<active-slug>/mapeamento` (verify by hovering or clicking).

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/access.ts
# If Option A:
git add -u src/app/(app)/mapeamento src/app/(app)/configuracoes
# If Option B:
git add src/app/(app)/mapeamento/page.tsx src/app/(app)/configuracoes/page.tsx
git commit -m "refactor(routes): remove duplicate global /mapeamento and /configuracoes routes"
```

---

## Task 12: Final smoke + acceptance criteria walkthrough

**Files:** none (verification only).

- [ ] **Step 1: Run the full lint + build**

```bash
npm run lint && npm run build
```

Expected: PASS.

- [ ] **Step 2: Walk through every acceptance criterion from the spec**

Open the spec at [docs/superpowers/specs/2026-05-13-menu-reorganization-design.md](../specs/2026-05-13-menu-reorganization-design.md) and tick off each "Critérios de aceite (smoke)" item against the running dev server:

- [ ] Admin with 3+ segments sees module switcher, segment dropdown, two-block sidebar.
- [ ] Admin with 1 segment: segment selector is a static label.
- [ ] `gestor_unidade` with 1 segment: 4 daily items only, no divider, no admin block.
- [ ] User with both DRE + Ctrl: module switcher appears; switching preserves context across visits (cookie persists).
- [ ] Switching segment on `/s/<old>/kpis` lands on `/s/<new>/kpis`.
- [ ] Switching segment on `/admin` does not redirect (just refreshes server components).
- [ ] Mobile drawer: selectors at top, sidebar below.
- [ ] `/mapeamento` and `/configuracoes` global routes: behavior matches Task 11 choice.
- [ ] Tema claro/escuro: divisor + label "ADMINISTRAÇÃO" legíveis em ambos.

- [ ] **Step 3: Tag the merge point**

If everything passes and you want a clean rollback target:

```bash
git tag pre-menu-reorg-merge
```

(Skip if you don't use tags for this purpose.)

---

## Out-of-scope follow-ups (track for later)

- Unread-count badge on the header `Bell` icon (requires a count query against Ctrl notifications).
- Command palette (`Cmd/Ctrl+K`) for quick page + segment search.
- `prefers-reduced-motion` audit on sidebar/drawer transitions.
- Migrating from `localStorage` theme to a cookie-backed theme so SSR can render the right palette on first paint (orthogonal to this work).
