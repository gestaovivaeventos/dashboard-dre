import type { SupabaseClient } from "@supabase/supabase-js";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
import { buildDashboardRows, filterCoreDreAccounts } from "@/lib/dashboard/dre";
import type { DreAccountBase } from "@/lib/dashboard/dre";
import { REPORT_SYSTEM_PROMPT } from "@/lib/intelligence/prompts";
import { renderReportEmail } from "@/lib/intelligence/render-email";
import type { ReportData } from "@/lib/intelligence/render-email";

export interface GenerateReportInput {
  supabase: SupabaseClient;
  companyIds: string[];
  dateFrom: string;
  dateTo: string;
  periodLabel: string;
}

export interface GenerateReportResult {
  html: string;
  json: Record<string, unknown>;
}

function prevMonthRange(dateFrom: string): { dateFrom: string; dateTo: string } {
  const d = new Date(dateFrom + "T00:00:00Z");
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0-indexed
  const prevYear = month === 0 ? year - 1 : year;
  const prevMonth = month === 0 ? 12 : month; // 1-indexed
  const from = `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
  const to = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { dateFrom: from, dateTo: to };
}

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
  });
}

function formatPct(value: number): string {
  return value.toFixed(1) + "%";
}

function changeType(current: number, prev: number): "up" | "down" | "neutral" {
  if (current > prev) return "up";
  if (current < prev) return "down";
  return "neutral";
}

function changePct(current: number, prev: number): string {
  if (prev === 0) return "—";
  const pct = ((current - prev) / Math.abs(prev)) * 100;
  return (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
}

export async function generateReport(input: GenerateReportInput): Promise<GenerateReportResult> {
  const { supabase, companyIds, dateFrom, dateTo, periodLabel } = input;

  // 1. Fetch company names
  const { data: companies } = await supabase
    .from("companies")
    .select("id, name")
    .in("id", companyIds);

  const companyName =
    companies && companies.length === 1
      ? companies[0].name
      : companies && companies.length > 1
        ? companies.map((c: { id: string; name: string }) => c.name).join(", ")
        : "Empresas Selecionadas";

  // 2. Fetch DRE accounts
  const { data: rawAccounts } = await supabase
    .from("dre_accounts")
    .select("id, code, name, parent_id, level, type, is_summary, formula, sort_order, active")
    .eq("active", true)
    .order("code");

  const accounts: DreAccountBase[] = filterCoreDreAccounts(rawAccounts ?? []);

  // 3. Aggregate current period
  const { data: currentAgg } = await supabase.rpc("dashboard_dre_aggregate", {
    p_company_ids: companyIds,
    p_date_from: dateFrom,
    p_date_to: dateTo,
  });

  const currentMap = new Map<string, number>();
  for (const row of currentAgg ?? []) {
    currentMap.set(row.dre_account_id, (currentMap.get(row.dre_account_id) ?? 0) + row.amount);
  }

  // 4. Aggregate previous month
  const prev = prevMonthRange(dateFrom);
  const { data: prevAgg } = await supabase.rpc("dashboard_dre_aggregate", {
    p_company_ids: companyIds,
    p_date_from: prev.dateFrom,
    p_date_to: prev.dateTo,
  });

  const prevMap = new Map<string, number>();
  for (const row of prevAgg ?? []) {
    prevMap.set(row.dre_account_id, (prevMap.get(row.dre_account_id) ?? 0) + row.amount);
  }

  // 5. Fetch budget entries for the period
  const fromMonth = parseInt(dateFrom.slice(5, 7), 10);
  const fromYear = parseInt(dateFrom.slice(0, 4), 10);
  const toMonth = parseInt(dateTo.slice(5, 7), 10);
  const toYear = parseInt(dateTo.slice(0, 4), 10);

  const { data: budgetRows } = await supabase
    .from("budget_entries")
    .select("dre_account_id, amount, year, month")
    .in("company_id", companyIds)
    .gte("year", fromYear)
    .lte("year", toYear);

  const budgetMap = new Map<string, number>();
  for (const b of budgetRows ?? []) {
    const inRange =
      b.year > fromYear ||
      (b.year === fromYear && b.month >= fromMonth);
    const beforeEnd =
      b.year < toYear ||
      (b.year === toYear && b.month <= toMonth);
    if (inRange && beforeEnd) {
      budgetMap.set(b.dre_account_id, (budgetMap.get(b.dre_account_id) ?? 0) + b.amount);
    }
  }

  // 6. Build DRE rows
  const { rows: currentRows } = buildDashboardRows(accounts, currentMap);
  const { rows: prevRows } = buildDashboardRows(accounts, prevMap);

  const prevRowById = new Map(prevRows.map((r) => [r.id, r]));

  // 7. Build JSON context (level <= 2)
  const contextRows = currentRows
    .filter((r) => r.level <= 2)
    .map((r) => ({
      code: r.code,
      name: r.name,
      value: r.value,
      prevValue: prevRowById.get(r.id)?.value ?? 0,
      budget: budgetMap.get(r.id) ?? null,
      pctRevenue: r.percentageOverNetRevenue,
    }));

  // 8. Call AI
  const { text } = await generateText({
    model: openai("gpt-4o-mini"),
    system: REPORT_SYSTEM_PROMPT,
    prompt: JSON.stringify({ periodo: periodLabel, empresa: companyName, dre: contextRows }),
  });

  // 9. Parse AI JSON
  const aiAnalysis = JSON.parse(text) as ReportData["aiAnalysis"] & {
    kpi_comentarios?: Record<string, string>;
  };

  // 10. Build KPI cards
  // Find rows by code — common DRE structure: 1=Receita Bruta, 4=Receita Líquida,
  // 7=Lucro Operacional Bruto, 11=Resultado do Exercício, 10=EBITDA
  const findRow = (code: string) => currentRows.find((r) => r.code === code);
  const findPrevRow = (code: string) => prevRows.find((r) => r.code === code);

  const receitaBrutaRow = findRow("1");
  const lucroOpRow = findRow("7");
  const resultadoRow = findRow("11");
  const receitaLiqRow = findRow("4");
  const receitaBrutaPrev = findPrevRow("1");
  const lucroOpPrev = findPrevRow("7");
  const resultadoPrev = findPrevRow("11");

  const pctOf = (value: number, base: number) =>
    base !== 0 ? (value / Math.abs(base)) * 100 : 0;

  const lucroOpPct = pctOf(lucroOpRow?.value ?? 0, receitaLiqRow?.value ?? 0);
  const resultadoPct = pctOf(resultadoRow?.value ?? 0, receitaLiqRow?.value ?? 0);

  const kpis: ReportData["kpis"] = [
    {
      label: "Receita Bruta",
      value: formatBRL(receitaBrutaRow?.value ?? 0),
      change: changePct(receitaBrutaRow?.value ?? 0, receitaBrutaPrev?.value ?? 0),
      changeType: changeType(receitaBrutaRow?.value ?? 0, receitaBrutaPrev?.value ?? 0),
    },
    {
      label: "Lucro Operacional Bruto",
      value: `${formatBRL(lucroOpRow?.value ?? 0)} (${formatPct(lucroOpPct)})`,
      change: changePct(lucroOpRow?.value ?? 0, lucroOpPrev?.value ?? 0),
      changeType: changeType(lucroOpRow?.value ?? 0, lucroOpPrev?.value ?? 0),
    },
    {
      label: "Resultado do Exercicio",
      value: `${formatBRL(resultadoRow?.value ?? 0)} (${formatPct(resultadoPct)})`,
      change: changePct(resultadoRow?.value ?? 0, resultadoPrev?.value ?? 0),
      changeType: changeType(resultadoRow?.value ?? 0, resultadoPrev?.value ?? 0),
    },
  ];

  // 11. Build budget comparison table (top 8 accounts with budget)
  const budgetComparison: ReportData["budgetComparison"] = currentRows
    .filter((r) => {
      const b = budgetMap.get(r.id);
      return b !== undefined && b !== 0;
    })
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 8)
    .map((r) => {
      const budget = budgetMap.get(r.id) ?? 0;
      const realized = r.value;
      const diff = realized - budget;
      return {
        account: r.name,
        previsto: formatBRL(budget),
        realizado: formatBRL(realized),
        variacao: formatPct(budget !== 0 ? (diff / Math.abs(budget)) * 100 : 0),
        varType: (diff >= 0 ? "up" : "down") as "up" | "down",
      };
    });

  // 12. Render email
  const reportData: ReportData = {
    companyName,
    periodLabel,
    kpis,
    aiAnalysis: {
      resumo: aiAnalysis.resumo,
      destaques_positivos: aiAnalysis.destaques_positivos,
      pontos_atencao: aiAnalysis.pontos_atencao,
      recomendacoes: aiAnalysis.recomendacoes,
    },
    budgetComparison: budgetComparison.length > 0 ? budgetComparison : undefined,
  };

  const html = renderReportEmail(reportData);

  const json: Record<string, unknown> = {
    companyName,
    periodLabel,
    kpis,
    aiAnalysis,
    budgetComparison,
    contextRows,
  };

  return { html, json };
}
