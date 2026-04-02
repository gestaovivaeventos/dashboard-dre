import { NextResponse } from "next/server";
import { getCurrentSessionContext } from "@/lib/auth/session";

export async function GET(request: Request) {
  const { supabase, user } = await getCurrentSessionContext();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const url = new URL(request.url);
  let companyId = url.searchParams.get("companyId");
  const companyName = url.searchParams.get("name");

  if (!companyId && companyName) {
    const { data: found } = await supabase
      .from("companies")
      .select("id")
      .ilike("name", `%${companyName}%`)
      .limit(1)
      .single();
    companyId = (found?.id as string) ?? null;
  }
  if (!companyId) return NextResponse.json({ error: "Informe companyId ou name" });

  // ALL __fundos_desp_2.08.94 entries for March 2026
  const { data: marchEntries } = await supabase
    .from("financial_entries")
    .select("omie_id,category_code,value,payment_date,description")
    .eq("company_id", companyId)
    .eq("category_code", "__fundos_desp_2.08.94")
    .gte("payment_date", "2026-03-01")
    .lte("payment_date", "2026-03-31");

  // ALL 2.08.94 entries (without fundos redirect) for March
  const { data: plainEntries } = await supabase
    .from("financial_entries")
    .select("omie_id,category_code,value,payment_date,description")
    .eq("company_id", companyId)
    .eq("category_code", "2.08.94")
    .gte("payment_date", "2026-03-01")
    .lte("payment_date", "2026-03-31");

  // ALL entries with EXTP-like omie_ids for March
  const { data: _extpEntries } = await supabase
    .from("financial_entries")
    .select("omie_id,category_code,value,payment_date,description")
    .eq("company_id", companyId)
    .gte("payment_date", "2026-03-01")
    .lte("payment_date", "2026-03-31")
    .or("category_code.eq.__fundos_desp_2.08.94,category_code.eq.2.08.94");

  // RPC for March
  const { data: rpc } = await supabase.rpc("dashboard_dre_aggregate", {
    p_company_ids: [companyId],
    p_date_from: "2026-03-01",
    p_date_to: "2026-03-31",
  });

  const { data: dreAccounts } = await supabase
    .from("dre_accounts")
    .select("id,code")
    .in("code", ["5.8", "5.9"]);
  const dreIdToCode = new Map((dreAccounts ?? []).map((a) => [a.id as string, a.code as string]));

  const rpcFundos = ((rpc ?? []) as Array<{ dre_account_id: string; amount: number }>)
    .filter((r) => dreIdToCode.has(r.dre_account_id))
    .map((r) => ({ code: dreIdToCode.get(r.dre_account_id), amount: r.amount }));

  return NextResponse.json({
    marchFundosDesp: {
      count: (marchEntries ?? []).length,
      sum: (marchEntries ?? []).reduce((s, e) => s + Number(e.value ?? 0), 0),
      entries: (marchEntries ?? []).map((e) => ({
        omie_id: e.omie_id,
        value: e.value,
        desc: String(e.description).slice(0, 60),
      })),
    },
    marchPlain208_94: {
      count: (plainEntries ?? []).length,
      entries: (plainEntries ?? []).map((e) => ({
        omie_id: e.omie_id,
        value: e.value,
      })),
    },
    rpcFundos,
  });
}
