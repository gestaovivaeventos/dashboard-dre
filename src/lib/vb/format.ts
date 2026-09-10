// Textos do extrato do VB. Client-safe (só Intl e strings).

import { formatDayBR } from "@/lib/ctrl/datetime";
import type { VbEntry } from "@/lib/vb/types";

/**
 * Moeda abreviada para eixo de gráfico: "R$ 1,2 mi", "R$ 300 mil", "R$ 850".
 * O valor cheio continua no tooltip — aqui só cabe o suficiente para dar escala.
 */
export function compactBRL(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1000000) {
    return `${sign}R$ ${(abs / 1000000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  }
  if (abs >= 1000) {
    return `${sign}R$ ${(abs / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
  }
  return `${sign}R$ ${abs.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
}

export function formatPercent(rate: number, digits = 2): string {
  const value = (rate * 100).toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${value}%`;
}

/**
 * Explicação do rendimento na linha do extrato:
 * "01/01/2026 a 31/03/2026 · 89 dias · 3,35% no período".
 */
export function describeRendimento(
  entry: Pick<VbEntry, "period_start" | "period_end" | "days" | "rate" | "rate_basis">,
): string | null {
  const parts: string[] = [];
  if (entry.period_start && entry.period_end) {
    parts.push(
      entry.period_start === entry.period_end
        ? formatDayBR(entry.period_end)
        : `${formatDayBR(entry.period_start)} a ${formatDayBR(entry.period_end)}`,
    );
  }
  if (entry.days != null) parts.push(`${entry.days} ${entry.days === 1 ? "dia" : "dias"}`);
  if (entry.rate_basis === "ajuste") {
    parts.push("ajuste manual");
  } else if (entry.rate != null) {
    if (entry.rate_basis === "mensal") parts.push(`${formatPercent(entry.rate)} a.m.`);
    else if (entry.rate_basis === "cdi") parts.push(`${formatPercent(entry.rate)} (CDI)`);
    else parts.push(`${formatPercent(entry.rate)} no período`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}
