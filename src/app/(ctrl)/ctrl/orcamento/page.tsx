import { redirect } from "next/navigation";

import { getCtrlUser, hasCtrlRole } from "@/lib/ctrl/auth";
import { createClient } from "@/lib/supabase/server";

interface BudgetRow {
  expense_type_id: string | null;
  name: string;
  orcado: number;
  aprovado: number;
  pendente: number;
}

async function getOrcamentoData(year: number) {
  const supabase = await createClient();

  const [budgetRes, requestsRes, typesRes] = await Promise.all([
    supabase
      .from("ctrl_budget")
      .select("expense_type_id, amount, ctrl_expense_types(name)")
      .eq("period_year", year),
    supabase
      .from("ctrl_requests")
      .select("expense_type_id, status, amount")
      .not("status", "in", '("rejeitado","estornado","inativado_csc")')
      .gte("created_at", `${year}-01-01`)
      .lt("created_at", `${year + 1}-01-01`),
    supabase
      .from("ctrl_expense_types")
      .select("id, name")
      .order("name"),
  ]);

  if (budgetRes.error) return { error: budgetRes.error.message };
  if (requestsRes.error) return { error: requestsRes.error.message };

  const types = typesRes.data ?? [];

  // Map expense_type_id → name
  const nameMap = new Map<string, string>(types.map((t) => [t.id, t.name]));
  nameMap.set("__none__", "Sem categoria");

  // Aggregate budget per expense_type
  const budgetMap = new Map<string, number>();
  for (const b of budgetRes.data ?? []) {
    const key = b.expense_type_id ?? "__none__";
    const expType = b.ctrl_expense_types as { name: string } | { name: string }[] | null;
    const typeName = (Array.isArray(expType) ? expType[0]?.name : expType?.name) ?? "Sem categoria";
    if (!nameMap.has(key)) nameMap.set(key, typeName);
    budgetMap.set(key, (budgetMap.get(key) ?? 0) + Number(b.amount));
  }

  // Aggregate realized per expense_type
  const aprovadoMap = new Map<string, number>();
  const pendenteMap = new Map<string, number>();
  for (const r of requestsRes.data ?? []) {
    const key = r.expense_type_id ?? "__none__";
    const isApproved = r.status === "aprovado" || r.status === "agendado";
    if (isApproved) {
      aprovadoMap.set(key, (aprovadoMap.get(key) ?? 0) + Number(r.amount));
    } else {
      pendenteMap.set(key, (pendenteMap.get(key) ?? 0) + Number(r.amount));
    }
  }

  // Merge all keys that appear in any map
  const allKeys = new Set<string>([
    ...Array.from(budgetMap.keys()),
    ...Array.from(aprovadoMap.keys()),
    ...Array.from(pendenteMap.keys()),
  ]);

  const rows: BudgetRow[] = Array.from(allKeys).map((key) => ({
    expense_type_id: key === "__none__" ? null : key,
    name: nameMap.get(key) ?? key,
    orcado: budgetMap.get(key) ?? 0,
    aprovado: aprovadoMap.get(key) ?? 0,
    pendente: pendenteMap.get(key) ?? 0,
  })).sort((a, b) => b.orcado - a.orcado || b.aprovado - a.aprovado);

  return { rows };
}

export default async function OrcamentoPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  if (!hasCtrlRole(ctx, "gerente", "diretor", "csc", "admin")) {
    redirect("/ctrl/requisicoes");
  }

  const year = new Date().getFullYear();
  const { rows = [], error } = await getOrcamentoData(year);

  const grandOrcado = rows.reduce((s, r) => s + r.orcado, 0);
  const grandAprovado = rows.reduce((s, r) => s + r.aprovado, 0);
  const grandPendente = rows.reduce((s, r) => s + r.pendente, 0);
  const grandDisponivel = grandOrcado - grandAprovado - grandPendente;

  const fmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

  function pct(value: number, total: number) {
    if (total <= 0) return 0;
    return Math.min(100, (value / total) * 100);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Orçamento {year}</h1>
        <p className="text-muted-foreground">
          Orçado vs realizado por tipo de despesa
        </p>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border p-4 space-y-1">
          <p className="text-xs font-medium uppercase text-muted-foreground">Orçado</p>
          <p className="text-xl font-bold">{fmt.format(grandOrcado)}</p>
        </div>
        <div className="rounded-lg border p-4 space-y-1">
          <p className="text-xs font-medium uppercase text-muted-foreground">Aprovado</p>
          <p className="text-xl font-bold text-green-600">{fmt.format(grandAprovado)}</p>
        </div>
        <div className="rounded-lg border p-4 space-y-1">
          <p className="text-xs font-medium uppercase text-muted-foreground">Pendente</p>
          <p className="text-xl font-bold text-amber-600">{fmt.format(grandPendente)}</p>
        </div>
        <div className="rounded-lg border p-4 space-y-1">
          <p className="text-xs font-medium uppercase text-muted-foreground">Disponível</p>
          <p className={`text-xl font-bold ${grandDisponivel < 0 ? "text-red-600" : "text-sky-600"}`}>
            {fmt.format(grandDisponivel)}
          </p>
        </div>
      </div>

      {/* Tabela */}
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum dado de orçamento ou requisição encontrado para {year}.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Tipo de despesa</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Orçado</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Aprovado</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Pendente</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Disponível</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-32">Execução</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => {
                const usado = row.aprovado + row.pendente;
                const disponivel = row.orcado - usado;
                const execPct = pct(row.aprovado, row.orcado);
                const pendPct = pct(row.pendente, row.orcado);
                const overBudget = row.orcado > 0 && usado > row.orcado;
                return (
                  <tr key={row.name} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-medium">{row.name}</td>
                    <td className="px-4 py-3 text-right">{fmt.format(row.orcado)}</td>
                    <td className="px-4 py-3 text-right text-green-600">{fmt.format(row.aprovado)}</td>
                    <td className="px-4 py-3 text-right text-amber-600">{fmt.format(row.pendente)}</td>
                    <td className={`px-4 py-3 text-right font-medium ${disponivel < 0 ? "text-red-600" : "text-sky-600"}`}>
                      {row.orcado > 0 ? fmt.format(disponivel) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {row.orcado > 0 ? (
                        <div className="space-y-1">
                          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                            <div className="h-full flex">
                              <div
                                className="bg-green-500 transition-all"
                                style={{ width: `${execPct}%` }}
                              />
                              <div
                                className={`transition-all ${overBudget ? "bg-red-400" : "bg-amber-400"}`}
                                style={{ width: `${Math.min(pendPct, 100 - execPct)}%` }}
                              />
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {(execPct + pendPct).toFixed(0)}% utilizado
                          </p>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">sem orçamento</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
