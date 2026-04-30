import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { reprocessBudgetEntriesForCompany } from "@/lib/budget/reprocess";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

interface BudgetMappingRow {
  id: string;
  label: string;
  dreAccountId: string | null;
  dreAccountCode: string | null;
  dreAccountName: string | null;
  rowsCount: number;
}

export async function GET(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const url = new URL(request.url);
  const companyId = url.searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "Informe companyId." }, { status: 400 });
  }

  const [{ data: mappings, error: mappingsErr }, { data: rawCounts, error: rawErr }] = await Promise.all([
    supabase
      .from("budget_account_mappings")
      .select("id,label,dre_account_id")
      .eq("company_id", companyId),
    supabase
      .from("budget_uploads_raw")
      .select("label")
      .eq("company_id", companyId),
  ]);

  if (mappingsErr) return NextResponse.json({ error: mappingsErr.message }, { status: 400 });
  if (rawErr) return NextResponse.json({ error: rawErr.message }, { status: 400 });

  const labelCounts = new Map<string, number>();
  ((rawCounts ?? []) as Array<{ label: string }>).forEach((row) => {
    labelCounts.set(row.label, (labelCounts.get(row.label) ?? 0) + 1);
  });

  const accountIds = Array.from(
    new Set(((mappings ?? []) as Array<{ dre_account_id: string | null }>).map((row) => row.dre_account_id).filter(Boolean)),
  ) as string[];
  const { data: accounts, error: accountsErr } = accountIds.length
    ? await supabase.from("dre_accounts").select("id,code,name").in("id", accountIds)
    : { data: [], error: null };
  if (accountsErr) return NextResponse.json({ error: accountsErr.message }, { status: 400 });

  const accountById = new Map(
    ((accounts ?? []) as Array<{ id: string; code: string; name: string }>).map((a) => [a.id, a]),
  );

  const rows: BudgetMappingRow[] = ((mappings ?? []) as Array<{
    id: string;
    label: string;
    dre_account_id: string | null;
  }>)
    .map((row) => {
      const account = row.dre_account_id ? accountById.get(row.dre_account_id) : null;
      return {
        id: row.id,
        label: row.label,
        dreAccountId: row.dre_account_id,
        dreAccountCode: account?.code ?? null,
        dreAccountName: account?.name ?? null,
        rowsCount: labelCounts.get(row.label) ?? 0,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

  return NextResponse.json({ rows });
}

export async function POST(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const body = (await request.json()) as {
    companyId?: string;
    mappings?: Array<{ label: string; dreAccountId: string | null }>;
  };

  const companyId = body.companyId?.trim();
  const mappings = body.mappings ?? [];
  if (!companyId) {
    return NextResponse.json({ error: "Informe companyId." }, { status: 400 });
  }

  const db = createAdminClientIfAvailable() ?? supabase;

  const { data: company, error: companyErr } = await db
    .from("companies")
    .select("id")
    .eq("id", companyId)
    .single();
  if (companyErr || !company) {
    return NextResponse.json({ error: "Empresa nao encontrada." }, { status: 404 });
  }

  // Validate all dre_account_ids
  const accountIds = Array.from(
    new Set(mappings.map((m) => m.dreAccountId).filter((id): id is string => Boolean(id))),
  );
  if (accountIds.length > 0) {
    const { data: validAccounts, error: validErr } = await db
      .from("dre_accounts")
      .select("id")
      .in("id", accountIds);
    if (validErr) return NextResponse.json({ error: validErr.message }, { status: 400 });
    const validSet = new Set(((validAccounts ?? []) as Array<{ id: string }>).map((a) => a.id));
    for (const m of mappings) {
      if (m.dreAccountId && !validSet.has(m.dreAccountId)) {
        return NextResponse.json(
          { error: `Conta DRE invalida: ${m.dreAccountId}` },
          { status: 400 },
        );
      }
    }
  }

  // Upsert mappings (one row per label)
  let saved = 0;
  let cleared = 0;
  for (const mapping of mappings) {
    const label = mapping.label?.trim();
    if (!label) continue;
    const dreAccountId = mapping.dreAccountId ?? null;
    if (dreAccountId === null) cleared += 1;
    else saved += 1;

    const { error: upsertErr } = await db
      .from("budget_account_mappings")
      .upsert(
        {
          company_id: companyId,
          label,
          dre_account_id: dreAccountId,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id,label" },
      );
    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 400 });
    }
  }

  // Re-apply mappings to budget_entries for all years that have raw uploads
  let reprocessed: { imported: number; unmappedLabels: string[] };
  try {
    reprocessed = await reprocessBudgetEntriesForCompany(db, companyId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    saved,
    cleared,
    imported: reprocessed.imported,
    unmappedLabels: reprocessed.unmappedLabels,
  });
}
