import Link from "next/link";
import { redirect } from "next/navigation";
import { Plane, Plus } from "lucide-react";

import { getViagensUser } from "@/lib/viagens/auth";
import { getViagemRequests } from "@/lib/viagens/queries";

export const dynamic = "force-dynamic";

const fmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

const STATUS_LABEL: Record<string, string> = {
  rascunho: "Rascunho",
  buscando: "Buscando…",
  cotado: "Aguardando escolha",
  aprovado: "Aprovada",
  reservado: "Reservada",
  concluido: "Concluída",
  rejeitado: "Rejeitada",
  erro: "Erro",
  cancelado: "Cancelada",
};

const STATUS_CLS: Record<string, string> = {
  buscando: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  cotado: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  aprovado: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  reservado: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  concluido: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  rejeitado: "bg-red-500/10 text-red-600 dark:text-red-400",
  erro: "bg-red-500/10 text-red-600 dark:text-red-400",
  cancelado: "bg-slate-500/10 text-slate-500",
};

export default async function ViagensRequisicoesPage() {
  const ctx = await getViagensUser();
  if (!ctx) redirect("/login");

  const requests = await getViagemRequests();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-primary">Viagens</h1>
          <p className="text-sm text-ink-muted">
            Peça uma cotação: o sistema busca as melhores opções de carro, ônibus e avião.
          </p>
        </div>
        <Link
          href="/viagens/requisicoes/nova"
          className="inline-flex items-center gap-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
        >
          <Plus className="h-4 w-4" /> Nova viagem
        </Link>
      </div>

      {requests.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-surface-1 p-10 text-center">
          <Plane className="h-8 w-8 text-ink-muted" />
          <p className="text-sm text-ink-muted">Nenhuma viagem ainda — peça a primeira cotação.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-ink-muted">
                <th className="px-4 py-2.5 font-medium">#</th>
                <th className="px-4 py-2.5 font-medium">Trajeto</th>
                <th className="px-4 py-2.5 font-medium">Período</th>
                <th className="px-4 py-2.5 font-medium">Pax</th>
                <th className="px-4 py-2.5 text-right font-medium">Melhor total</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Solicitante</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-surface-2/50">
                  <td className="px-4 py-2.5 tabular-nums text-ink-muted">{r.request_number}</td>
                  <td className="px-4 py-2.5">
                    <Link href={`/viagens/requisicoes/${r.id}`} className="font-medium text-ink-primary hover:underline">
                      {r.origem} → {r.destino}
                    </Link>
                    {r.monitorar && <span className="ml-2 text-[10px] uppercase text-teal-600 dark:text-teal-400">monitorando</span>}
                  </td>
                  <td className="px-4 py-2.5 text-ink-secondary">
                    {fmtDate(r.data_ida)} – {fmtDate(r.data_volta)}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-ink-secondary">{r.passageiros}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-primary">
                    {r.melhor_total != null ? `R$ ${fmt.format(r.melhor_total)}` : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLS[r.status] ?? "bg-surface-2 text-ink-secondary"}`}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-ink-secondary">{r.created_by_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
