import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckSquare } from "lucide-react";

import { getViagensUser } from "@/lib/viagens/auth";
import { getViagemRequests } from "@/lib/viagens/queries";

export const dynamic = "force-dynamic";

const fmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

export default async function ViagensAprovacoesPage() {
  const ctx = await getViagensUser();
  if (!ctx) redirect("/login");
  if (!ctx.isAprovador) redirect("/viagens/requisicoes");

  const all = await getViagemRequests();
  const pendentes = all.filter((r) => r.status === "cotado");
  const aprovadas = all.filter((r) => r.status === "aprovado");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-primary">Aprovações de viagem</h1>
        <p className="text-sm text-ink-muted">
          Viagens cotadas aguardando você escolher uma das 3 opções — e aprovadas aguardando reserva.
        </p>
      </div>

      <Section title={`Aguardando escolha (${pendentes.length})`} empty="Nada aguardando escolha." rows={pendentes} fmtDate={fmtDate} fmtNum={fmt} />
      <Section title={`Aprovadas — falta reservar (${aprovadas.length})`} empty="Nenhuma aprovada pendente de reserva." rows={aprovadas} fmtDate={fmtDate} fmtNum={fmt} />
    </div>
  );
}

function Section({
  title,
  empty,
  rows,
  fmtDate,
  fmtNum,
}: {
  title: string;
  empty: string;
  rows: Awaited<ReturnType<typeof getViagemRequests>>;
  fmtDate: (iso: string) => string;
  fmtNum: Intl.NumberFormat;
}) {
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-primary">
        <CheckSquare className="h-4 w-4 text-teal-500" /> {title}
      </h2>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-surface-1 p-4 text-sm text-ink-muted">{empty}</p>
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
                <th className="px-4 py-2.5 font-medium">Solicitante</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-surface-2/50">
                  <td className="px-4 py-2.5 tabular-nums text-ink-muted">{r.request_number}</td>
                  <td className="px-4 py-2.5 font-medium text-ink-primary">
                    {r.origem} → {r.destino}
                  </td>
                  <td className="px-4 py-2.5 text-ink-secondary">
                    {fmtDate(r.data_ida)} – {fmtDate(r.data_volta)}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-ink-secondary">{r.passageiros}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-primary">
                    {r.melhor_total != null ? `R$ ${fmtNum.format(r.melhor_total)}` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-ink-secondary">{r.created_by_name}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Link
                      href={`/viagens/requisicoes/${r.id}`}
                      className="rounded-md bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700"
                    >
                      Analisar
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
