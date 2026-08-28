import { redirect } from "next/navigation";

import { getCtrlUser, hasCtrlRole } from "@/lib/ctrl/auth";
import { countsTowardBudget } from "@/lib/ctrl/budget-cutoff";
import { currentYearBR } from "@/lib/ctrl/datetime";
import { createClient } from "@/lib/supabase/server";
import { BudgetUpload } from "@/components/ctrl/budget-upload";
import { OrcamentoTable, type OrcamentoRow } from "@/components/ctrl/orcamento-table";

/**
 * @param sectorFilter lista de setores a que a visão está restrita, ou null
 *   para ver tudo. Usado pelo perfil "Gerente" (gerente_setor), que enxerga
 *   apenas as despesas dos setores vinculados a ele.
 */
async function getOrcamentoData(year: number, sectorFilter: string[] | null) {
  const supabase = await createClient();

  let budgetQuery = supabase
    .from("ctrl_budget")
    .select("expense_type_id, sector_id, amount, realized, ctrl_expense_types(name)")
    .eq("period_year", year);
  // Requisições de 1 setor (is_rateio = false). As rateadas entram pelas suas
  // parcelas (rateioQuery), cada uma no orçamento do SEU setor.
  let requestsQuery = supabase
    .from("ctrl_requests")
    .select("expense_type_id, sector_id, status, amount, due_date, created_at")
    .not("status", "in", '("rejeitado","estornado","inativado_csc")')
    .is("deleted_at", null) // exclui requisições excluídas logicamente
    .eq("is_rateio", false)
    .eq("reference_year", year);
  // Parcelas dos rateios, filtradas pelo SETOR da parcela (não o setor primário
  // da requisição) — assim o gerente escopado vê a parte que cai no setor dele.
  let rateioQuery = supabase
    .from("ctrl_request_sectors")
    .select("sector_id, amount, ctrl_requests!inner(expense_type_id, status, due_date, created_at, reference_year, deleted_at)")
    .not("ctrl_requests.status", "in", '("rejeitado","estornado","inativado_csc")')
    .is("ctrl_requests.deleted_at", null)
    .eq("ctrl_requests.reference_year", year);
  let sectorsQuery = supabase.from("ctrl_sectors").select("id, name");

  // Escopo por setor: linhas sem setor ("Sem setor") também ficam de fora,
  // já que não pertencem a nenhum setor do usuário.
  if (sectorFilter) {
    budgetQuery = budgetQuery.in("sector_id", sectorFilter);
    requestsQuery = requestsQuery.in("sector_id", sectorFilter);
    rateioQuery = rateioQuery.in("sector_id", sectorFilter);
    sectorsQuery = sectorsQuery.in("id", sectorFilter);
  }

  const [budgetRes, requestsRes, rateioRes, typesRes, sectorsRes] = await Promise.all([
    budgetQuery,
    requestsQuery,
    rateioQuery,
    supabase.from("ctrl_expense_types").select("id, name").order("name"),
    sectorsQuery,
  ]);

  if (budgetRes.error) return { error: budgetRes.error.message };
  if (requestsRes.error) return { error: requestsRes.error.message };
  if (rateioRes.error) return { error: rateioRes.error.message };

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

  // Parcelas dos rateios: cada uma no orçamento do SEU setor. A classificação
  // (realizado/pendente) segue o status da requisição-mãe (só vira realizado
  // quando a requisição inteira é aprovada/enviada).
  for (const row of rateioRes.data ?? []) {
    const req = (Array.isArray(row.ctrl_requests) ? row.ctrl_requests[0] : row.ctrl_requests) as
      | { expense_type_id: string | null; status: string; due_date: string | null; created_at: string }
      | null;
    if (!req) continue;
    if (!countsTowardBudget(req, year)) continue;
    const typeKey = req.expense_type_id ?? "__none__";
    const sectorKey = (row.sector_id as string | null) ?? "__none__";
    const isApproved = req.status === "aprovado" || req.status === "agendado";
    bump(typeKey, sectorKey, isApproved ? "realizado" : "pendente", Number(row.amount));
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

/** Nomes dos setores do usuário — só pra legenda da visão restrita. */
async function getSectorNames(sectorIds: string[]): Promise<string[]> {
  if (sectorIds.length === 0) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("ctrl_sectors").select("name").in("id", sectorIds);
  return (data ?? []).map((s) => s.name);
}

export default async function OrcamentoPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  if (!hasCtrlRole(ctx, "gerente", "diretor", "csc", "admin")) {
    redirect("/ctrl/requisicoes");
  }

  const year = currentYearBR();
  const canEditBudget = hasCtrlRole(ctx, "csc", "admin");

  // Perfil "Gerente" (gerente_setor): vê apenas os setores vinculados a ele.
  // Sem setor vinculado não há nada a exibir — não caímos no fallback de ver
  // tudo. Os demais perfis (inclusive "Gerente Sócio") seguem vendo todos.
  const sectorScoped = ctx.profile === "gerente_setor";
  const sectorFilter = sectorScoped ? ctx.sectorIds : null;
  const sectorNames = sectorScoped ? await getSectorNames(ctx.sectorIds) : [];

  const { rows = [], error } =
    sectorScoped && ctx.sectorIds.length === 0
      ? { rows: [] as OrcamentoRow[], error: undefined }
      : await getOrcamentoData(year, sectorFilter);

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
          {sectorScoped && sectorNames.length > 0
            ? ` — ${sectorNames.join(", ")}`
            : ""}
        </p>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {canEditBudget && <BudgetUpload defaultYear={year} />}

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" data-tour="orc-kpis">
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
            {sectorScoped && ctx.sectorIds.length === 0
              ? "Seu usuário não está vinculado a nenhum setor. Peça ao administrador para vincular um setor em Usuários."
              : `Nenhum dado de orçamento ou requisição encontrado para ${year}.`}
          </p>
        </div>
      ) : (
        <div data-tour="orc-tabela">
          <OrcamentoTable rows={rows} />
        </div>
      )}
    </div>
  );
}
