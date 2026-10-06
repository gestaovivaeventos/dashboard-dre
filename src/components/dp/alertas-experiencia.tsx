import Link from "next/link";

import { formatDayBR } from "@/lib/ctrl/datetime";
import type { DpAlertaExperienciaComEmpresa } from "@/lib/dp/alertas";

/**
 * Lista de experiência vencendo — mesmo conteúdo na Visão geral do DP e na tela
 * inicial. O 1º período pede "prorrogar ou efetivar"; a prorrogação, "efetivar
 * ou desligar": a linha diz qual das duas decisões está chegando.
 */
export function DpListaAlertasExperiencia({ alertas }: { alertas: DpAlertaExperienciaComEmpresa[] }) {
  return (
    <ul className="space-y-1 text-sm">
      {alertas.map((a) => (
        <li key={`${a.id}-${a.periodo}`} className="flex flex-wrap items-baseline gap-x-3">
          <span className={`w-24 shrink-0 tabular-nums ${a.diasRestantes <= 5 ? "font-medium text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
            {a.diasRestantes === 0 ? "hoje" : `em ${a.diasRestantes} dia(s)`}
          </span>
          <Link href={`/dp/colaboradores/${a.id}`} className="font-medium text-ink-primary hover:underline">
            {a.nome}
          </Link>
          <span className="text-ink-muted">
            {a.periodo === 1 ? "fim do 1º período — prorrogar ou efetivar" : "fim da prorrogação — efetivar ou desligar"} ·{" "}
            {formatDayBR(a.fim)}
            {a.empresa ? ` · ${a.empresa}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
