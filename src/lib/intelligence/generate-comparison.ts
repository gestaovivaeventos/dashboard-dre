import type { SupabaseClient } from "@supabase/supabase-js";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { buildDashboardRows, fetchAllDreAccountRows, filterCoreDreAccounts } from "@/lib/dashboard/dre";

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
import type { DreAccountBase } from "@/lib/dashboard/dre";
import { resolveFranquiasVivaCustosNegationForCompanies } from "@/lib/dashboard/franquias-viva-custos";
import { COMPARISON_SYSTEM_PROMPT } from "@/lib/intelligence/prompts";
import { renderComparisonEmail } from "@/lib/intelligence/render-email";
import type { ComparisonData } from "@/lib/intelligence/render-email";

export interface GenerateComparisonInput {
  supabase: SupabaseClient;
  companyIds: string[];
  dateFrom: string;
  dateTo: string;
  periodLabel: string;
  segmentName: string;
}

export interface GenerateComparisonResult {
  html: string;
  json: Record<string, unknown>;
}

export async function generateComparison(
  input: GenerateComparisonInput
): Promise<GenerateComparisonResult> {
  const { supabase, companyIds, dateFrom, dateTo, periodLabel, segmentName } = input;

  // 1. Fetch company names
  const { data: companies } = await supabase
    .from("companies")
    .select("id, name")
    .in("id", companyIds);

  const companyNameMap = new Map<string, string>(
    (companies ?? []).map((c: { id: string; name: string }) => [c.id, c.name])
  );

  // 2. Fetch DRE accounts (paginado: o cap de 1000 do PostgREST truncava os
  // codes "8"/"9" — ver fetchAllDreAccountRows).
  const rawAccounts = await fetchAllDreAccountRows<DreAccountBase>((from, to) =>
    supabase
      .from("dre_accounts")
      .select("id, code, name, parent_id, level, type, is_summary, formula, sort_order, active")
      .eq("active", true)
      .order("code")
      .range(from, to),
  );

  const accounts: DreAccountBase[] = filterCoreDreAccounts(rawAccounts);

  // Franquias Viva: "Receitas Ressarciveis - Fundos" (5.8) é receita dentro do
  // grupo de custos (5) e reduz o total — mesma regra do Dashboard DRE. Inerte
  // para outros segmentos. Resolve o segmento a partir das empresas comparadas.
  const custosNegation = await resolveFranquiasVivaCustosNegationForCompanies(
    supabase,
    companyIds,
    accounts,
  );

  // 3. Aggregate by company
  const { data: byCompanyAgg } = await supabase.rpc(
    "dashboard_dre_aggregate_by_company",
    {
      p_company_ids: companyIds,
      p_date_from: dateFrom,
      p_date_to: dateTo,
    }
  );

  // Group amounts per company
  const amountsByCompany = new Map<string, Map<string, number>>();
  for (const row of byCompanyAgg ?? []) {
    let map = amountsByCompany.get(row.company_id);
    if (!map) {
      map = new Map<string, number>();
      amountsByCompany.set(row.company_id, map);
    }
    map.set(row.dre_account_id, (map.get(row.dre_account_id) ?? 0) + row.amount);
  }

  // 4. Build DRE rows per company (level <= 2)
  const companiesContext: Record<string, unknown>[] = [];
  for (const companyId of companyIds) {
    const amountMap = amountsByCompany.get(companyId) ?? new Map<string, number>();
    const { rows } = buildDashboardRows(accounts, amountMap, {
      negateChildCodesInSummary: custosNegation,
    });
    const topRows = rows
      .filter((r) => r.level <= 2)
      .map((r) => ({
        code: r.code,
        name: r.name,
        value: r.value,
        pctRevenue: r.percentageOverNetRevenue,
      }));

    companiesContext.push({
      empresa: companyNameMap.get(companyId) ?? companyId,
      dre: topRows,
    });
  }

  // 5. Call AI
  const { text } = await generateText({
    model: openai("gpt-4o-mini"),
    system: COMPARISON_SYSTEM_PROMPT,
    prompt: JSON.stringify({
      periodo: periodLabel,
      segmento: segmentName,
      empresas: companiesContext,
    }),
  });

  // 6. Parse AI JSON and render
  const aiAnalysis = JSON.parse(text) as ComparisonData["aiAnalysis"];

  const comparisonData: ComparisonData = {
    segmentName,
    periodLabel,
    aiAnalysis,
  };

  const html = renderComparisonEmail(comparisonData);

  const json: Record<string, unknown> = {
    segmentName,
    periodLabel,
    aiAnalysis,
    companiesContext,
  };

  return { html, json };
}
