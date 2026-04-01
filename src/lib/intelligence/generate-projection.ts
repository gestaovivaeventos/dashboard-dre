import type { SupabaseClient } from "@supabase/supabase-js";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
import { buildDashboardRows, filterCoreDreAccounts } from "@/lib/dashboard/dre";
import type { DreAccountBase } from "@/lib/dashboard/dre";
import { PROJECTION_SYSTEM_PROMPT } from "@/lib/intelligence/prompts";
import { renderProjectionEmail } from "@/lib/intelligence/render-email";

export interface GenerateProjectionInput {
  supabase: SupabaseClient;
  companyId: string;
  horizonMonths: number;
}

export async function generateProjection({
  supabase,
  companyId,
  horizonMonths,
}: GenerateProjectionInput) {
  const { data: companyData } = await supabase
    .from("companies")
    .select("name")
    .eq("id", companyId)
    .maybeSingle<{ name: string }>();
  const companyName = companyData?.name ?? "Empresa";

  const { data: accountsData } = await supabase
    .from("dre_accounts")
    .select("id,code,name,parent_id,level,type,is_summary,formula,sort_order,active")
    .eq("active", true)
    .order("code");
  const accounts = filterCoreDreAccounts((accountsData ?? []) as DreAccountBase[]);

  // Fetch last 12 months of data
  const now = new Date();
  const months: { label: string; dateFrom: string; dateTo: string }[] = [];
  for (let i = 12; i >= 1; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const from = d.toISOString().slice(0, 10);
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    months.push({
      label: `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`,
      dateFrom: from,
      dateTo: end.toISOString().slice(0, 10),
    });
  }

  const historico = await Promise.all(
    months.map(async (m) => {
      const { data } = await supabase.rpc("dashboard_dre_aggregate", {
        p_company_ids: [companyId],
        p_date_from: m.dateFrom,
        p_date_to: m.dateTo,
      });
      const map = new Map<string, number>();
      ((data ?? []) as Array<{ dre_account_id: string; amount: number | string | null }>).forEach(
        (row) => map.set(row.dre_account_id, Number(row.amount ?? 0)),
      );
      const { rows } = buildDashboardRows(accounts, map);
      const summary = rows
        .filter((r) => r.level <= 2)
        .map((r) => ({ code: r.code, name: r.name, value: r.value, pctRevenue: r.percentageOverNetRevenue }));
      return { mes: m.label, indicadores: summary };
    }),
  );

  const horizonLabel = `Proximos ${horizonMonths} meses`;

  const { text } = await generateText({
    model: openai("gpt-4o-mini"),
    system: PROJECTION_SYSTEM_PROMPT,
    prompt: `Historico de 12 meses de "${companyName}". Projete os proximos ${horizonMonths} meses.\n\n${JSON.stringify(historico, null, 2)}`,
  });

  const aiAnalysis = JSON.parse(text);
  const html = renderProjectionEmail({ companyName, horizonLabel, aiAnalysis });

  return { html, json: { historico, aiAnalysis } };
}
