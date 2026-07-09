import { redirect } from "next/navigation";

import { getCaseUser } from "@/lib/case/auth";
import { getDashboardData, type CaseClosingStatus, type CaseProjectRow } from "@/lib/case/queries";

export const dynamic = "force-dynamic";

const fmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = new Intl.NumberFormat("pt-BR");

function brl(v: number): string {
  return `R$ ${fmt.format(v)}`;
}

function dateBR(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-");
  return `${day}/${m}/${y}`;
}

const STATUS_LABEL: Record<CaseClosingStatus, string> = {
  aguardando_evento: "Aguardando Evento",
  pendente_fechamento: "Pendente Fechamento",
  fechamento_enviado: "Fechamento Enviado",
  concluido: "Concluído",
  cancelado: "Cancelado",
};

const STATUS_PILL: Record<CaseClosingStatus, string> = {
  aguardando_evento: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  pendente_fechamento: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  fechamento_enviado: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  concluido: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  cancelado: "bg-red-500/10 text-red-600 dark:text-red-400",
};

function Indicador({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: string;
  accent?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-1 p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${accent ?? "text-ink-primary"}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-muted">{hint}</div>}
    </div>
  );
}

function money(v: number): string {
  return v < 0 ? `(${fmt.format(Math.abs(v))})` : fmt.format(v);
}

function moneyCls(v: number): string {
  if (v > 0) return "text-emerald-600 dark:text-emerald-400";
  if (v < 0) return "text-red-500";
  return "text-ink-muted";
}

export default async function CaseDashboardPage() {
  const ctx = await getCaseUser();
  if (!ctx) redirect("/login");

  const d = await getDashboardData();

  const rows: CaseProjectRow[] = d.projetos;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-primary">Dashboard — Fechamento de Contratos</h1>
        <p className="text-sm text-ink-muted">Indicadores gerais e resultado por projeto (CS Agência).</p>
      </div>

      {/* INDICADORES GERAIS */}
      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Indicadores gerais</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Indicador label="Receita evento" value={brl(d.receitaEvento)} />
          <Indicador label="Receita BV (Case)" value={brl(d.receitaBv)} accent="text-emerald-600 dark:text-emerald-400" />
          <Indicador label="Custo evento" value={brl(d.custoEvento)} accent="text-red-500" />
          <Indicador
            label="Comissão terceiros"
            value={brl(d.comissaoTerceiros)}
            accent={d.comissaoTerceiros < 0 ? "text-red-500" : undefined}
          />
          <Indicador
            label="Resultado líquido"
            value={brl(d.resultadoLiquido)}
            accent={moneyCls(d.resultadoLiquido)}
          />
          <Indicador
            label="Comissão / intermédio"
            value={brl(d.aReceber)}
            hint={`Recebido ${brl(d.recebido)}`}
          />
        </div>
      </div>

      {/* TOTAL PROJETOS + STATUS */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador label="Total projetos" value={fmtInt.format(d.totalProjetos)} />
        <Indicador
          label="Concluídos"
          value={fmtInt.format(d.statusCount.concluido)}
          accent="text-emerald-600 dark:text-emerald-400"
        />
        <Indicador
          label="Pendente fechamento"
          value={fmtInt.format(d.statusCount.pendente_fechamento + d.statusCount.fechamento_enviado)}
          accent="text-amber-600 dark:text-amber-400"
        />
        <Indicador
          label="Aguardando evento"
          value={fmtInt.format(d.statusCount.aguardando_evento)}
          accent="text-sky-600 dark:text-sky-400"
        />
      </div>

      {/* RESULTADO POR PROJETO */}
      <div className="rounded-lg border border-border bg-surface-1">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-ink-primary">Resultado por projeto</h2>
        </div>
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-muted">Sem contratos lançados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wide text-ink-muted">
                  <th className="px-3 py-2 text-left font-medium">NP</th>
                  <th className="px-3 py-2 text-left font-medium">Projeto</th>
                  <th className="px-3 py-2 text-left font-medium">Tipo</th>
                  <th className="px-3 py-2 text-right font-medium">Rec. evento</th>
                  <th className="px-3 py-2 text-right font-medium">Custo evento</th>
                  <th className="px-3 py-2 text-right font-medium">Comissão</th>
                  <th className="px-3 py-2 text-right font-medium">BV CS</th>
                  <th className="px-3 py-2 text-right font-medium">Result. esperado</th>
                  <th className="px-3 py-2 text-right font-medium">Result. atual</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Data evento</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-b border-border/60 last:border-0 hover:bg-surface-2/50">
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-ink-secondary">NP {p.np}</td>
                    <td className="max-w-[280px] truncate px-3 py-2 text-ink-primary" title={p.projeto}>
                      {p.projeto}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{p.tipo}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">{money(p.recEvento)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${moneyCls(p.custoEvento)}`}>{money(p.custoEvento)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${moneyCls(p.comissao)}`}>{money(p.comissao)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{money(p.bvCs)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">{money(p.resultadoEsperado)}</td>
                    <td className={`px-3 py-2 text-right font-medium tabular-nums ${moneyCls(p.resultadoAtual)}`}>{money(p.resultadoAtual)}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_PILL[p.closingStatus]}`}>
                        {STATUS_LABEL[p.closingStatus]}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{dateBR(p.dataEvento)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border font-semibold text-ink-primary">
                  <td className="px-3 py-2" colSpan={3}>
                    Total geral
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(d.receitaEvento)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-red-500">{money(d.custoEvento)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-red-500">{money(d.comissaoTerceiros)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{money(d.receitaBv)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(rows.reduce((a, p) => a + p.resultadoEsperado, 0))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(d.resultadoLiquido)}</td>
                  <td className="px-3 py-2" colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
