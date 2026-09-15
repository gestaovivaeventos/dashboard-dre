// src/lib/vb/report/status.ts
// Status de cada linha da tela "Relatórios mensais". DERIVADO, nunca gravado:
// o banco só guarda os envios (vb_report_sends); o resto sai do cadastro e
// do extrato. Puro, testado.

export type VbReportStatus = "sem_email" | "rendimento_pendente" | "pronto" | "enviado";

export const VB_REPORT_STATUS_LABELS: Record<VbReportStatus, string> = {
  sem_email: "Sem e-mail",
  rendimento_pendente: "Rendimento pendente",
  pronto: "Pronto",
  enviado: "Enviado",
};

/**
 * - enviado: existe envio oficial (ou reenvio) daquele credor naquele mês —
 *   vale mesmo sem e-mail hoje ou sem rendimento fechado: o que foi, foi.
 * - sem_email: sem destinatário, não há como enviar.
 * - rendimento_pendente: o último rendimento lançado termina antes do fim
 *   do mês — o extrato sairia sem o CDI do mês. Credor com saldo zero ou
 *   negativo o mês inteiro não tem rendimento a esperar e conta como pronto.
 * - pronto: dá para enviar.
 */
export function reportStatusFor(input: {
  email: string | null;
  closingDate: string;
  lastYieldEnd: string | null;
  /** Houve saldo positivo em algum momento do mês (abertura ou depois de alguma linha). */
  hadPositiveBalance: boolean;
  hasOfficialSend: boolean;
}): VbReportStatus {
  if (input.hasOfficialSend) return "enviado";
  if (!input.email) return "sem_email";
  if (input.hadPositiveBalance && (!input.lastYieldEnd || input.lastYieldEnd < input.closingDate)) {
    return "rendimento_pendente";
  }
  return "pronto";
}

/** 'YYYY-MM' do mês anterior ao informado. */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}

export function isMonthKey(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
