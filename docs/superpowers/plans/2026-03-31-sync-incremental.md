# Sync Incremental com Marca d'Agua — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the Omie sync engine to use watermark-based incremental sync (daily cron) with a manual full-sync button per company (24 months / since 2022 for first time).

**Architecture:** Add `last_full_sync_at` to `companies` and `sync_type` to `sync_log`. Refactor `syncEntries()` to accept `mode` and `dateRange` parameters. Cron runs incremental (last watermark - 3 days); manual button triggers full sync per company. Incremental never deletes; full upserts then cleans obsolete entries.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (Postgres), shadcn/ui, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-31-sync-incremental-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/20260331120000_add_sync_watermark.sql` | Add `last_full_sync_at` to companies, `sync_type` to sync_log |
| Modify | `src/lib/omie/sync.ts` | Accept sync mode/dateRange, conditional delete logic |
| Create | `src/app/api/sync/[companyId]/full/route.ts` | New endpoint for manual full sync |
| Modify | `src/app/api/cron/sync-all/route.ts` | Run incremental instead of full, read watermark |
| Modify | `src/components/app/connections-grid.tsx` | Add "Sincronizar Tudo" button, watermark display |
| Modify | `src/app/api/connections/route.ts` | Include `last_full_sync_at` in response |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260331120000_add_sync_watermark.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Add watermark column to companies
ALTER TABLE public.companies
ADD COLUMN last_full_sync_at timestamptz;

-- Add sync_type column to sync_log
ALTER TABLE public.sync_log
ADD COLUMN sync_type text NOT NULL DEFAULT 'full'
CHECK (sync_type IN ('incremental', 'full'));

-- For companies that already have financial_entries, set watermark to now()
-- so the next cron runs incremental instead of a full re-sync from 2022.
UPDATE public.companies
SET last_full_sync_at = NOW()
WHERE id IN (
  SELECT DISTINCT company_id FROM public.financial_entries
);
```

- [ ] **Step 2: Apply migration**

Run: `npx supabase db push`
Expected: Migration applied successfully.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260331120000_add_sync_watermark.sql
git commit -m "feat: add sync watermark column and sync_type to support incremental sync"
```

---

## Task 2: Refactor `syncEntries()` to Accept Mode and Date Range

**Files:**
- Modify: `src/lib/omie/sync.ts:391-513`

- [ ] **Step 1: Add SyncMode type and update syncEntries signature**

At the top of `src/lib/omie/sync.ts` (after existing imports/types, near line 41), add:

```typescript
export type SyncMode = "incremental" | "full";
```

Update the `syncEntries` function signature (line 391) to accept mode and date range:

```typescript
async function syncEntries({
  companyId,
  appKey,
  appSecret,
  lastRequestRef,
  mode,
  dateFrom,
  dateTo,
}: {
  companyId: string;
  appKey: string;
  appSecret: string;
  lastRequestRef: { value: number };
  mode: SyncMode;
  dateFrom: string;
  dateTo: string;
}): Promise<SyncResult> {
```

- [ ] **Step 2: Remove hardcoded dates and make delete conditional**

Replace the hardcoded date block (lines 404-407):

```typescript
  // OLD:
  // const dateFrom = "01-01-2026";
  // const dateTo = "31-12-2026";
  // NEW: dateFrom and dateTo come from parameters
```

Replace the delete block (lines 437-458) with conditional logic:

```typescript
  // 5. Limpar lancamentos obsoletos (somente no modo full).
  let recordsDeleted = 0;
  if (mode === "full") {
    const validOmieIds = new Set(uniqueEntries.map((e) => e.omie_id));
    const { data: existingEntries } = await supabase
      .from("financial_entries")
      .select("id, omie_id")
      .eq("company_id", companyId);

    const idsToDelete = (existingEntries ?? [])
      .filter((e) => !validOmieIds.has(e.omie_id as string))
      .map((e) => e.id as string);

    for (const batch of chunk(idsToDelete, 50)) {
      const { error } = await supabase
        .from("financial_entries")
        .delete()
        .in("id", batch);
      if (error) {
        throw new Error(
          `Falha ao limpar lancamentos obsoletos: ${error.message}`,
        );
      }
    }
    recordsDeleted = idsToDelete.length;
  }
```

- [ ] **Step 3: Update SyncResult to include recordsDeleted**

Update the `SyncResult` interface (near line 41):

```typescript
interface SyncResult {
  recordsImported: number;
  recordsDeleted: number;
  categories: Array<{ company_id: string; code: string; description: string }>;
  newUnmappedCategories: Array<{
    company_id: string;
    code: string;
    description: string;
  }>;
}
```

Update the return statement at the end of `syncEntries` (line 508):

```typescript
  return {
    recordsImported: uniqueEntries.length,
    recordsDeleted,
    categories,
    newUnmappedCategories,
  };
```

- [ ] **Step 4: Update `runCompanySyncInternal` to pass mode and dates**

Add a helper function to format dates for the Omie API (DD-MM-YYYY) near the top of the file:

```typescript
function formatDateForOmie(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function calculateDateRange(
  mode: SyncMode,
  lastFullSyncAt: string | null,
): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const dateTo = formatDateForOmie(now);

  if (mode === "full") {
    if (!lastFullSyncAt) {
      // First time: since 2022
      return { dateFrom: "01-01-2022", dateTo };
    }
    // Manual full: last 24 months
    const from = new Date(now);
    from.setMonth(from.getMonth() - 24);
    return { dateFrom: formatDateForOmie(from), dateTo };
  }

  // Incremental: from watermark - 3 days
  if (!lastFullSyncAt) {
    // No watermark yet — treat as full from 2022
    return { dateFrom: "01-01-2022", dateTo };
  }
  const from = new Date(lastFullSyncAt);
  from.setDate(from.getDate() - 3);
  return { dateFrom: formatDateForOmie(from), dateTo };
}
```

Update the public entry points to accept an optional mode:

```typescript
export async function runCompanySync(
  companyId: string,
  profile: UserProfile,
  mode: SyncMode = "incremental",
) {
  return runCompanySyncInternal(companyId, {
    profile,
    skipPermission: false,
    mode,
  });
}

export async function runCompanySyncAsSystem(
  companyId: string,
  mode: SyncMode = "incremental",
) {
  return runCompanySyncInternal(companyId, {
    profile: null,
    skipPermission: true,
    mode,
  });
}
```

Update `runCompanySyncInternal` (line 301) to read watermark, compute dates, and pass to `syncEntries`:

```typescript
async function runCompanySyncInternal(
  companyId: string,
  options: {
    profile: UserProfile | null;
    skipPermission: boolean;
    mode: SyncMode;
  },
) {
  const supabase = await createSupabaseClient();
  if (!options.skipPermission) {
    const isAllowed = await canSyncCompany(options.profile, companyId);
    if (!isAllowed) {
      throw new Error("Sem permissao para sincronizar esta empresa.");
    }
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id, omie_app_key, omie_app_secret, last_full_sync_at")
    .eq("id", companyId)
    .single<{
      id: string;
      omie_app_key: string | null;
      omie_app_secret: string | null;
      last_full_sync_at: string | null;
    }>();

  if (companyError || !company) {
    throw new Error("Empresa nao encontrada.");
  }

  // If no watermark exists and mode is incremental, upgrade to full
  const effectiveMode =
    options.mode === "incremental" && !company.last_full_sync_at
      ? "full"
      : options.mode;

  const { dateFrom, dateTo } = calculateDateRange(
    effectiveMode,
    company.last_full_sync_at,
  );

  const { data: syncLog, error: syncLogError } = await supabase
    .from("sync_log")
    .insert({
      company_id: companyId,
      started_at: new Date().toISOString(),
      status: "running",
      records_imported: 0,
      sync_type: effectiveMode,
    })
    .select("id")
    .single<{ id: string }>();

  if (syncLogError || !syncLog) {
    throw new Error("Nao foi possivel iniciar o log de sincronizacao.");
  }

  try {
    if (!company.omie_app_key || !company.omie_app_secret) {
      throw new Error(
        "Credenciais da Omie nao configuradas para esta empresa.",
      );
    }

    const appKey = decryptSecret(company.omie_app_key);
    const appSecret = decryptSecret(company.omie_app_secret);
    const lastRequestRef = { value: 0 };

    const result = await syncEntries({
      companyId,
      appKey,
      appSecret,
      lastRequestRef,
      mode: effectiveMode,
      dateFrom,
      dateTo,
    });

    // Update watermark only on full sync success
    if (effectiveMode === "full") {
      await supabase
        .from("companies")
        .update({ last_full_sync_at: new Date().toISOString() })
        .eq("id", companyId);
    }

    await supabase
      .from("sync_log")
      .update({
        finished_at: new Date().toISOString(),
        status: "success",
        records_imported: result.recordsImported,
        error_message: null,
      })
      .eq("id", syncLog.id);

    return result;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Erro inesperado no processo de sync.";
    await supabase
      .from("sync_log")
      .update({
        finished_at: new Date().toISOString(),
        status: "error",
        error_message: message,
      })
      .eq("id", syncLog.id);
    throw error;
  }
}
```

- [ ] **Step 5: Verify build passes**

Run: `npm run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/omie/sync.ts
git commit -m "feat: refactor sync engine to support incremental and full modes with watermark"
```

---

## Task 3: Create Full Sync API Endpoint

**Files:**
- Create: `src/app/api/sync/[companyId]/full/route.ts`

- [ ] **Step 1: Create the endpoint**

```typescript
import { NextResponse } from "next/server";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { runCompanySync } from "@/lib/omie/sync";

type Params = { params: { companyId: string } };

export async function POST(_: Request, { params }: Params) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin" && profile.role !== "gestor_hero") {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  try {
    const result = await runCompanySync(params.companyId, profile, "full");
    return NextResponse.json({
      ok: true,
      recordsImported: result.recordsImported,
      recordsDeleted: result.recordsDeleted,
      categoriesImported: result.categories.length,
      newUnmappedCategories: result.newUnmappedCategories.length,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Falha inesperada ao sincronizar empresa.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
```

- [ ] **Step 2: Update existing sync endpoint to pass incremental mode**

In `src/app/api/sync/[companyId]/route.ts`, update the `runCompanySync` call to explicitly pass `"incremental"`:

```typescript
    const result = await runCompanySync(params.companyId, profile, "incremental");
```

Also update the response to include `recordsDeleted`:

```typescript
    return NextResponse.json({
      ok: true,
      recordsImported: result.recordsImported,
      recordsDeleted: result.recordsDeleted,
      categoriesImported: result.categories.length,
      newUnmappedCategories: result.newUnmappedCategories.length,
    });
```

- [ ] **Step 3: Verify build passes**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/sync/[companyId]/full/route.ts src/app/api/sync/[companyId]/route.ts
git commit -m "feat: add full sync endpoint and update existing sync to incremental mode"
```

---

## Task 4: Update Cron Endpoint for Incremental Sync

**Files:**
- Modify: `src/app/api/cron/sync-all/route.ts`

- [ ] **Step 1: Update cron to call runCompanySyncAsSystem with incremental mode**

The cron already calls `runCompanySyncAsSystem(companyId)` which now defaults to `"incremental"`. The function internally promotes to `"full"` when `last_full_sync_at` is NULL. No code change needed in the cron endpoint itself — the default parameter handles it.

Verify by reading the file and confirming `runCompanySyncAsSystem` is called without a mode argument (it will default to `"incremental"`).

- [ ] **Step 2: Verify build passes**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit (skip if no changes needed)**

If the cron endpoint needed any adjustments:
```bash
git add src/app/api/cron/sync-all/route.ts
git commit -m "feat: update cron to use incremental sync by default"
```

---

## Task 5: Update Connections API to Include Watermark

**Files:**
- Modify: `src/app/api/connections/route.ts`

- [ ] **Step 1: Add `last_full_sync_at` to the company query and response**

In the company query, add `last_full_sync_at` to the select. In the response mapping, include the field:

```typescript
// In the select query for companies, add last_full_sync_at:
.select("id, name, active, segment_id, last_full_sync_at")

// In the response object for each company, add:
last_full_sync_at: company.last_full_sync_at,
```

- [ ] **Step 2: Verify build passes**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/connections/route.ts
git commit -m "feat: include last_full_sync_at in connections API response"
```

---

## Task 6: Add "Sincronizar Tudo" Button to UI

**Files:**
- Modify: `src/components/app/connections-grid.tsx`

- [ ] **Step 1: Update ConnectionCompany interface**

Add `last_full_sync_at` to the interface (line 10):

```typescript
interface ConnectionCompany {
  id: string;
  name: string;
  last_sync_at: string | null;
  last_full_sync_at: string | null;  // NEW
  last_sync_status: "success" | "error" | "running" | null;
  last_sync_error: string | null;
  entries_count: number;
  sync_history: Array<{
    started_at: string;
    finished_at: string | null;
    status: "success" | "error" | "running";
    records_imported: number;
    error_message: string | null;
    duration_seconds: number | null;
  }>;
}
```

- [ ] **Step 2: Add state and handler for full sync**

After the existing `syncingByCompany` state (around line 65), add:

```typescript
const [fullSyncingByCompany, setFullSyncingByCompany] = useState<
  Record<string, boolean>
>({});
```

After the existing `handleSync` function (line 141), add:

```typescript
const handleFullSync = async (companyId: string, isFirstTime: boolean) => {
  const message = isFirstTime
    ? "Primeira sincronizacao — sera buscado historico desde 2022. Isso pode levar varios minutos. Continuar?"
    : "Isso vai buscar 24 meses de historico. Pode levar alguns minutos. Continuar?";

  if (!window.confirm(message)) return;

  setFullSyncingByCompany((previous) => ({ ...previous, [companyId]: true }));
  setStatusMessage(null);

  const response = await fetch(`/api/sync/${companyId}/full`, {
    method: "POST",
  });
  const payload = (await response.json()) as {
    error?: string;
    recordsImported?: number;
    recordsDeleted?: number;
  };
  if (!response.ok) {
    setStatusMessage(payload.error ?? "Falha na sincronizacao completa.");
    showToast({
      title: "Falha na sincronizacao completa",
      description: payload.error ?? "A empresa nao foi sincronizada.",
      variant: "destructive",
    });
  } else {
    showToast({
      title: "Sincronizacao completa concluida",
      description: `${payload.recordsImported ?? 0} registros importados, ${payload.recordsDeleted ?? 0} obsoletos removidos.`,
      variant: "success",
    });
    await loadCompanies();
  }

  setFullSyncingByCompany((previous) => ({
    ...previous,
    [companyId]: false,
  }));
};
```

- [ ] **Step 3: Add the button and watermark display to the card**

In the card content area (after the existing "Sincronizar Agora" button, around line 203), add the new button and watermark info:

```tsx
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    void handleFullSync(
                      company.id,
                      !company.last_full_sync_at,
                    )
                  }
                  disabled={
                    (fullSyncingByCompany[company.id] ?? false) || syncing
                  }
                >
                  {fullSyncingByCompany[company.id] ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCcw className="mr-2 h-4 w-4" />
                  )}
                  Sincronizar Tudo
                </Button>
                <p className="text-xs text-muted-foreground">
                  {company.last_full_sync_at
                    ? `Ultima sync completa: ${formatDateTime(company.last_full_sync_at)}`
                    : "Sync completa: Pendente"}
                </p>
```

- [ ] **Step 4: Verify build passes**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Verify lint passes**

Run: `npm run lint`
Expected: No lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/app/connections-grid.tsx
git commit -m "feat: add full sync button and watermark display to connections grid"
```

---

## Task 7: Final Verification

- [ ] **Step 1: Run full build**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: No lint errors.

- [ ] **Step 3: Manual smoke test**

Start dev server: `npm run dev`

1. Open `/conexoes` page
2. Verify each company card shows:
   - "Sincronizar Agora" button (incremental)
   - "Sincronizar Tudo" button (full)
   - Watermark text ("Ultima sync completa: ..." or "Sync completa: Pendente")
3. Click "Sincronizar Agora" on a company — should run quickly (incremental)
4. Click "Sincronizar Tudo" on a company — should show confirmation dialog, then run full sync

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address issues found during smoke testing"
```
