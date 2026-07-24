import { redirect } from "next/navigation";

import { getCtrlUser, hasCtrlRole } from "@/lib/ctrl/auth";
import { countsTowardBudget } from "@/lib/ctrl/budget-cutoff";
import { createClient } from "@/lib/supabase/server";
import { BudgetUpload } from "@/components/ctrl/budget-upload";
import { OrcamentoTable, type OrcamentoRow } from "@/components/ctrl/orcamento-table";

async function getOrcamentoData(year: number) {
  const supabase = await createClient();

  const [budgetRes, requestsRes, typesRes, sectorsRes] = await Promise.all([
    supabase
      .from("ctrl_budget")
      .select("expense_type_id, sector_id, amount, realized, ctrl_expense_types(name)")
      .eq("period_year", year),
    supabase
      .from("ctrl_requests")
      .select("expense_type_id, sector_id, status, amount, due_date, created_at")
      .not("status", "in", '("rejeitado","estornado","inativado_csc")')
      .is("deleted_at", null) // exclui requisições excluídas logicamente
      .eq("reference_year", year),
    supabase.from("ctrl_expense_types").select("id, name").order("name"),
    supabase.from("ctrl_sectors").select("id, name"),
  ]);

  if (budgetRes.error) return { error: budgetRes.error.message };
  if (requestsRes.error) return { error: requestsRes.error.message };

  const typeName = new Map<string, string>((typesRes.data ?? []).map((t) => [t.id, t.name]));
  typeName.set("__none__", "Sem categoria");
  const sectorName = new Map<string, string>((sectorsRes.data ?? []).map((s) => [s.id, s.name]));
  sectorName.set("__none__", "Sem setor");

  // Acumuladores por tipo (totais) e por (tipo × setor) — o detalhamento.
  type Agg = { orcado: number; realizado: number; pendente: number };
  const newAgg = (): Agg => ({ orcado: 0, realizado: 0, pendente: 0 });
  const typeAgg = new Map<string, Agg>();
  const sectorAgg = new Map<string, Map<string, Agg>>();

  const bump = (typeKey: string, sectorKey: string, field: keyof Agg, val: number) => {
    let t = typeAgg.get(typeKey);
    if (!t) { t = newAgg(); typeAgg.set(typeKey, t); }
    t[field] += val;
    let sm = sectorAgg.get(typeKey);
    if (!sm) { sm = new Map(); sectorAgg.set(typeKey, sm); }
    let s = sm.get(sectorKey);
    if (!s) { s = newAgg(); sm.set(sectorKey, s); }
    s[field] += val;
  };

  // Orçado + realizado importado da planilha (por tipo × setor).
  for (const b of budgetRes.data ?? []) {
    const typeKey = b.expense_type_id ?? "__none__";
    const sectorKey = b.sector_id ?? "__none__";
    const expType = b.ctrl_expense_types as { name: string } | { name: string }[] | null;
    const nm = (Array.isArray(expType) ? expType[0]?.name : expType?.name) ?? null;
    if (nm && !typeName.has(typeKey)) typeName.set(typeKey, nm);
    bump(typeKey, sectorKey, "orcado", Number(b.amount));
    bump(typeKey, sectorKey, "realizado", Number(b.realized ?? 0));
  }

  // A planilha-base já carrega o realizado até o corte (ver budget-cutoff.ts). O
  // realizado/pendente dinâmico só conta ocorrências com VENCIMENTO a partir do
  // corte, evitando desconto duplicado. Aprovadas/agendadas → realizado; demais
  // em aberto → pendente. Mesmo critério da agregação por tipo, agora por setor.
  for (const r of requestsRes.data ?? []) {
    if (!countsTowardBudget(r, year)) continue;
    const typeKey = r.expense_type_id ?? "__none__";
    const sectorKey = r.sector_id ?? "__none__";
    const isApproved = r.status === "aprovado" || r.status === "agendado";
    bump(typeKey, sectorKey, isApproved ? "realizado" : "pendente", Number(r.amount));
  }

  const rows: OrcamentoRow[] = Array.from(typeAgg.entries())
    .map(([typeKey, t]) => {
      const sectors = Array.from(sectorAgg.get(typeKey)?.entries() ?? [])
        .map(([sectorKey, a]) => ({
          sector_id: sectorKey === "__none__" ? null : sectorKey,
          sector_name: sectorName.get(sectorKey) ?? sectorKey,
          orcado: a.orcado,
          realizado: a.realizado,
          pendente: a.pendente,
        }))
        .sort((x, y) => y.orcado - x.orcado || y.realizado - x.realizado);
      return {
        expense_type_id: typeKey === "__none__" ? null : typeKey,
        name: typeName.get(typeKey) ?? typeKey,
        orcado: t.orcado,
        realizado: t.realizado,
        pendente: t.pendente,
        sectors,
      };
    })
    .sort((a, b) => b.orcado - a.orcado || b.realizado - a.realizado);

  return { rows };
}

export default async function OrcamentoPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  if (!hasCtrlRole(ctx, "gerente", "diretor", "csc", "admin")) {
    redirect("/ctrl/requisicoes");
  }

  const year = new Date().getFullYear();
  const canEditBudget = hasCtrlRole(ctx, "csc", "admin");
  const { rows = [], error } = await getOrcamentoData(year);

  const grandOrcado = rows.reduce((s, r) => s + r.orcado, 0);
  const grandRealizado = rows.reduce((s, r) => s + r.realizado, 0);
  const grandPendente = rows.reduce((s, r) => s + r.pendente, 0);
  const grandDisponivel = grandOrcado - grandRealizado - grandPendente;

  const fmt = new Intl.NumberFormat("pt-BR", { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

      {canEditBudget && <BudgetUpload defaultYear={year} />}

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border p-4 space-y-1">
          <p className="text-xs font-medium uppercase text-muted-foreground">Orçado</p>
          <p className="text-xl font-bold">{fmt.format(grandOrcado)}</p>
        </div>
        <div className="rounded-lg border p-4 space-y-1">
          <p className="text-xs font-medium uppercase text-muted-foreground">Realizado</p>
          <p className="text-xl font-bold text-green-600">{fmt.format(grandRealizado)}</p>
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

      {/* Tabela — clique num tipo de despesa para ver o detalhamento por setor */}
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum dado de orçamento ou requisição encontrado para {year}.
          </p>
        </div>
      ) : (
        <OrcamentoTable rows={rows} />
      )}
    </div>
  );
}
