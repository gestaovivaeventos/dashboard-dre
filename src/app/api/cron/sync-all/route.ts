import { NextResponse } from "next/server";

import { sendSyncFailureEmail, sendUnmappedCategoriesEmail } from "@/lib/notifications/resend";
import { runCompanySyncAsSystem } from "@/lib/omie/sync";
import { createClient } from "@/lib/supabase/server";

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

  const supabase = await createClient();
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

  await Promise.all([
    sendSyncFailureEmail(failures),
    sendUnmappedCategoriesEmail(unmappedCategories),
  ]);

  return NextResponse.json({
    ok: failures.length === 0,
    processed: results.length,
    failed: failures.length,
    unmappedCategories: unmappedCategories.length,
    results,
  });
}
