// Faixa de indicadores do VB: quatro caixas rasas, densas, no lugar dos Cards
// altos. Compartilhada pela Visão geral e pelo extrato do credor para as duas
// telas não divergirem. Sem hooks — as duas são server components.

export type VbStatTone = "default" | "entrada" | "saida" | "rendimento" | "negative";

export interface VbStat {
  label: string;
  /** Já formatado pelo chamador (moeda, contagem…). */
  value: string;
  tone?: VbStatTone;
  /** Indicador principal (saldo): fonte um pouco maior. */
  emphasis?: boolean;
}

const TONE: Record<VbStatTone, string> = {
  default: "text-ink-primary",
  entrada: "text-emerald-700",
  saida: "text-red-600",
  rendimento: "text-sky-700",
  negative: "text-red-600",
};

export function VbStatStrip({ stats }: { stats: VbStat[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-md border border-border bg-surface-1 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-ink-muted">{stat.label}</div>
          <div
            className={`font-semibold tabular-nums ${stat.emphasis ? "text-lg" : "text-base"} ${
              TONE[stat.tone ?? "default"]
            }`}
          >
            {stat.value}
          </div>
        </div>
      ))}
    </div>
  );
}
