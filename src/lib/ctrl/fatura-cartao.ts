// Vencimento da PRÓXIMA fatura do cartão de crédito a partir de HOJE (horário de
// Brasília). A fatura fecha no dia 23 e vence no dia 05:
//   • compra até o dia 23 (inclusive) → vence dia 05 do mês seguinte (offset 1);
//   • compra a partir do dia 24        → vence dia 05 do mês subsequente (offset 2).
//
// É o MESMO ciclo aplicado no servidor (calculateInstallmentDates) para desdobrar
// as parcelas. Função pura (sem dependência de servidor) — pode ser usada tanto
// na nova requisição quanto na edição em Contas a Pagar. Retorna 'YYYY-MM-DD'.
export function nextFaturaDueDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const y = get("year");
  const m = get("month"); // 1-based
  const d = get("day");
  const monthOffset = d > 23 ? 2 : 1;
  const totalOffset = m - 1 + monthOffset; // base 0
  const dueMonth = ((totalOffset % 12) + 12) % 12;
  const dueYear = y + Math.floor(totalOffset / 12);
  return `${dueYear}-${String(dueMonth + 1).padStart(2, "0")}-05`;
}
