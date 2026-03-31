import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";

export async function GET(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }

  const url = new URL(request.url);
  const companyName = url.searchParams.get("companyName") ?? "Empresa";

  const { data: accounts } = await supabase
    .from("dre_accounts")
    .select("code,name,is_summary")
    .eq("active", true)
    .order("code");

  // Only leaf accounts (non-summary) receive direct values
  const leafAccounts = (accounts ?? []).filter(
    (a) => !(a.is_summary as boolean),
  );

  const lines: string[] = [];
  lines.push("Empresa,Ano,Mes,Conta do DRE,Valor orcado");

  for (let month = 1; month <= 12; month++) {
    for (const account of leafAccounts) {
      const code = account.code as string;
      const name = (account.name as string).replace(/"/g, '""');
      lines.push(`"${companyName}",2026,${month},"${code} - ${name}","0,00"`);
    }
  }

  const csv = "\uFEFF" + lines.join("\r\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="template_orcamento_${companyName.replace(/\s+/g, "_")}.csv"`,
    },
  });
}
