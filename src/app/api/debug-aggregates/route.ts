import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

// Valida a pre-agregacao do DRE (dre_monthly_aggregates) comparando, para uma
// empresa e periodo, a RPC materializada (dashboard_dre_aggregate) com a versao
// AO VIVO (dashboard_dre_aggregate_live, que varre financial_entries). Se as
// duas baterem em todas as contas, a materializacao esta correta.
//
// Uso: /api/debug-aggregates?companyId=<uuid>&from=2026-01-01&to=2026-12-31

export async function GET(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const url = new URL(request.url);
  const companyId = url.searchParams.get("companyId");
  const from = url.searchParams.get("from") ?? "2026-01-01";
  const to = url.searchParams.get("to") ?? "2026-12-31";
  if (!companyId) {
    return NextResponse.json({ error: "Informe companyId." }, { status: 400 });
  }

  const db = createAdminClientIfAvailable() ?? supabase;

  const params = { p_company_ids: [companyId], p_date_from: from, p_date_to: to };
  const [mat, live] = await Promise.all([
    db.rpc("dashboard_dre_aggregate", params),
    db.rpc("dashboard_dre_aggregate_live", params),
  ]);
  if (mat.error) {
    return NextResponse.json({ error: `materializado: ${mat.error.message}` }, { status: 400 });
  }
  if (live.error) {
    return NextResponse.json({ error: `ao vivo: ${live.error.message}` }, { status: 400 });
  }

  type Row = { dre_account_id: string; amount: number | string | null };
  const toMap = (rows: Row[] | null) => {
    const m = new Map<string, number>();
    (rows ?? []).forEach((r) => m.set(r.dre_account_id, Number(r.amount ?? 0)));
    return m;
  };
  const matMap = toMap(mat.data as Row[] | null);
  const liveMap = toMap(live.data as Row[] | null);

  const accountIds = new Set<string>([
    ...Array.from(matMap.keys()),
    ...Array.from(liveMap.keys()),
  ]);
  const round = (n: number) => Math.round(n * 100) / 100;
  const diffs: Array<{ dre_account_id: string; materializado: number; aoVivo: number; delta: number }> = [];
  accountIds.forEach((id) => {
    const a = round(matMap.get(id) ?? 0);
    const b = round(liveMap.get(id) ?? 0);
    if (Math.abs(a - b) > 0.01) {
      diffs.push({ dre_account_id: id, materializado: a, aoVivo: b, delta: round(a - b) });
    }
  });

  return NextResponse.json({
    companyId,
    from,
    to,
    contasComparadas: accountIds.size,
    bate: diffs.length === 0,
    divergencias: diffs,
  });
}
