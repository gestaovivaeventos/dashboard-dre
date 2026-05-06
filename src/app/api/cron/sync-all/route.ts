import { NextResponse } from "next/server";

import {
  sendSyncFailureEmail,
  sendUnmappedCategoriesEmail,
  sendUnmappedEntriesAlertEmail,
} from "@/lib/notifications/resend";
import { runCompanySyncAsSystem } from "@/lib/omie/sync";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: companies, error: companiesError } = await supabase
    .from("companies")
    .select("id,name,active")
    .eq("active", true)
    .order("name");

  if (companiesError) {
    return NextResponse.json({ error: companiesError.message }, { status: 400 });
  }

  const failures: Array<{ companyId: string; companyName: string; error: string }> = [];
  const unmappedCategories: Array<{
    companyId: string;
    companyName: string;
    code: string;
    description: string;
  }> = [];
  const results: Array<{
    companyId: string;
    companyName: string;
    ok: boolean;
    recordsImported: number;
    categoriesUnmapped: number;
    error?: string;
  }> = [];

  for (const company of companies ?? []) {
    const companyId = company.id as string;
    const companyName = company.name as string;

    try {
      const result = await runCompanySyncAsSystem(companyId, "rolling");
      result.newUnmappedCategories.forEach((category) => {
        unmappedCategories.push({
          companyId,
          companyName,
          code: category.code,
          description: category.description,
        });
      });
      results.push({
        companyId,
        companyName,
        ok: true,
        recordsImported: result.recordsImported,
        categoriesUnmapped: result.newUnmappedCategories.length,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha inesperada na sincronizacao.";
      failures.push({ companyId, companyName, error: message });
      results.push({
        companyId,
        companyName,
        ok: false,
        recordsImported: 0,
        categoriesUnmapped: 0,
        error: message,
      });
    }
  }

  // Auditoria de lancamentos invisiveis no dashboard apos os syncs:
  // varre os ultimos 90 dias de TODAS as empresas ativas. Se aparecer
  // qualquer entry com categoria sem mapeamento DRE, alerta o admin.
  // Esta e a defesa principal contra o sintoma "drilldown != dashboard"
  // — entries sem mapping ficam fora da agregacao da DRE silenciosamente.
  const allCompanyIds = (companies ?? []).map((c) => c.id as string);
  const today = new Date();
  const since = new Date(today);
  since.setDate(since.getDate() - 90);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  let unmappedEntries: Array<{
    companyName: string;
    categoryCode: string;
    categoryName: string;
    entryCount: number;
    totalValue: number;
    oldestPayment: string;
    newestPayment: string;
  }> = [];

  if (allCompanyIds.length > 0) {
    const { data: auditData, error: auditError } = await supabase.rpc(
      "dashboard_dre_unmapped_entries_audit",
      {
        p_company_ids: allCompanyIds,
        p_date_from: fmt(since),
        p_date_to: fmt(today),
      },
    );
    if (!auditError && Array.isArray(auditData)) {
      unmappedEntries = auditData.map((row) => ({
        companyName: String(row.company_name ?? ""),
        categoryCode: String(row.category_code ?? ""),
        categoryName: String(row.category_name ?? ""),
        entryCount: Number(row.entry_count ?? 0),
        totalValue: Number(row.total_value ?? 0),
        oldestPayment: String(row.oldest_payment ?? ""),
        newestPayment: String(row.newest_payment ?? ""),
      }));
    }
  }

  await Promise.all([
    sendSyncFailureEmail(failures),
    sendUnmappedCategoriesEmail(unmappedCategories),
    sendUnmappedEntriesAlertEmail(unmappedEntries),
  ]);

  return NextResponse.json({
    ok: failures.length === 0,
    processed: results.length,
    failed: failures.length,
    unmappedCategories: unmappedCategories.length,
    unmappedEntries: unmappedEntries.length,
    results,
  });
}
