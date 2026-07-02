import { redirect } from "next/navigation";

import { getCaseUser } from "@/lib/case/auth";
import { getDashboardData } from "@/lib/case/queries";

export const dynamic = "force-dynamic";

const fmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = new Intl.NumberFormat("pt-BR");

const STATUS_LABEL: Record<string, string> = {
  lancado: "Lançado",
  parcial: "Parcial",
  erro: "Erro",
  rascunho: "Rascunho",
  cancelado: "Cancelado",
};

function Card({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-1 p-4">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${accent ?? "text-ink-primary"}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-muted">{hint}</div>}
    </div>
  );
}

export default async function CaseDashboardPage() {
  const ctx = await getCaseUser();
  if (!ctx) redirect("/login");

  const d = await getDashboardData();
  const maxMes = Math.max(1, ...d.porMes.map((m) => m.vendido));
  const maxArtista = Math.max(1, ...d.porArtista.map((a) => a.total));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-primary">Dashboard Case</h1>
        <p className="text-sm text-ink-muted">Visão macro dos contratos de shows.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card label="Contratos" value={fmtInt.format(d.totalContratos)} hint={`Ticket médio R$ ${fmt.format(d.ticketMedio)}`} />
        <Card label="Total vendido" value={`R$ ${fmt.format(d.totalVendido)}`} />
        <Card label="Custódia / repasse a artistas" value={`R$ ${fmt.format(d.totalCustodia)}`} accent="text-amber-600 dark:text-amber-400" />
        <Card label="Receita de serviços" value={`R$ ${fmt.format(d.totalServicos)}`} accent="text-emerald-600 dark:text-emerald-400" />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card label="A receber lançado" value={`R$ ${fmt.format(d.aReceberAberto)}`} />
        <Card label="A pagar lançado" value={`R$ ${fmt.format(d.aPagarAberto)}`} />
        <Card label="Títulos com erro" value={fmtInt.format(d.titulosComErro)} accent={d.titulosComErro > 0 ? "text-red-500" : undefined} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Por mês */}
        <div className="rounded-lg border border-border bg-surface-1 p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink-primary">Vendido por mês do evento</h2>
          {d.porMes.length === 0 ? (
            <p className="text-sm text-ink-muted">Sem dados.</p>
          ) : (
            <div className="space-y-2">
              {d.porMes.map((m) => (
                <div key={m.mes} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-xs text-ink-muted">{m.mes}</span>
                  <div className="h-4 flex-1 rounded bg-surface-2">
                    <div
                      className="h-4 rounded bg-amber-500/70"
                      style={{ width: `${(m.vendido / maxMes) * 100}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right text-xs tabular-nums text-ink-secondary">
                    R$ {fmt.format(m.vendido)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Status */}
        <div className="rounded-lg border border-border bg-surface-1 p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink-primary">Contratos por status</h2>
          {Object.keys(d.porStatus).length === 0 ? (
            <p className="text-sm text-ink-muted">Sem dados.</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(d.porStatus).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between text-sm">
                  <span className="text-ink-secondary">{STATUS_LABEL[status] ?? status}</span>
                  <span className="tabular-nums font-medium text-ink-primary">{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Por artista */}
      <div className="rounded-lg border border-border bg-surface-1 p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-primary">Top artistas por valor vendido</h2>
        {d.porArtista.length === 0 ? (
          <p className="text-sm text-ink-muted">Sem dados.</p>
        ) : (
          <div className="space-y-2">
            {d.porArtista.map((a) => (
              <div key={a.name} className="flex items-center gap-2">
                <span className="w-40 shrink-0 truncate text-xs text-ink-secondary" title={a.name}>
                  {a.name}
                </span>
                <div className="h-4 flex-1 rounded bg-surface-2">
                  <div className="h-4 rounded bg-emerald-500/60" style={{ width: `${(a.total / maxArtista) * 100}%` }} />
                </div>
                <span className="w-24 shrink-0 text-right text-xs tabular-nums text-ink-secondary">
                  R$ {fmt.format(a.total)}
                </span>
                <span className="w-10 shrink-0 text-right text-xs text-ink-muted">{a.contratos}c</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
