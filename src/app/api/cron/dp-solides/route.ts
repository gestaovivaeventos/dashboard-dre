import { NextResponse } from "next/server";

import { isCronAuthorized } from "@/lib/auth/cron";
import { runDpSolidesSync } from "@/lib/dp/solides/sync";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// GET /api/cron/dp-solides — espelho diário do cadastro da Sólides no DP.
// "0 8 * * *" no vercel.json = 05:00 de Brasília (a Vercel agenda em UTC).
// A resposta traz só contagens — nunca nome, CPF ou salário: o JSON do cron
// fica nos logs da Vercel, que outras pessoas leem.
// ============================================================================

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runDpSolidesSync(createAdminClient(), { trigger: "cron" });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DP sync failed.";
    console.error("[dp-solides] cron failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
