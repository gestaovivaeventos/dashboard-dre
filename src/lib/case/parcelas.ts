import type { CaseParcelaInput } from "@/lib/case/types";

// Helpers puros de parcelas (sem "use server") — reusados pelas actions de etapa
// e testáveis isoladamente.

export const cents = (v: number) => Math.round((Number(v) || 0) * 100);
export const sumCents = (ps: CaseParcelaInput[]) => ps.reduce((a, p) => a + cents(p.valor), 0);

export function validarSchedule(ps: CaseParcelaInput[], totalReais: number, label: string): string | null {
  if (ps.length === 0) return `Informe ao menos uma parcela para ${label}.`;
  for (const p of ps) {
    if (!p.vencimento) return `Parcela sem vencimento em ${label}.`;
    if (cents(p.valor) <= 0) return `Parcela com valor inválido em ${label}.`;
  }
  if (sumCents(ps) !== cents(totalReais)) {
    return `A soma das parcelas de ${label} (R$ ${(sumCents(ps) / 100).toFixed(2)}) não confere com o total (R$ ${totalReais.toFixed(2)}).`;
  }
  return null;
}

/** Rateia `totalCents` na mesma proporção do cronograma; ajusta a última pra fechar exatamente. */
export function prorateCents(totalCents: number, schedule: CaseParcelaInput[]): number[] {
  const sc = schedule.map((p) => cents(p.valor));
  const soma = sc.reduce((a, b) => a + b, 0);
  if (soma <= 0) return schedule.map(() => 0);
  const out = sc.map((v, i) => (i === schedule.length - 1 ? 0 : Math.round((totalCents * v) / soma)));
  const alocado = out.slice(0, -1).reduce((a, b) => a + b, 0);
  out[out.length - 1] = totalCents - alocado;
  return out;
}
