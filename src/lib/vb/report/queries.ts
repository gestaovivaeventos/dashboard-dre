// src/lib/vb/report/queries.ts
// Linhas da tela "Relatórios mensais": um credor ativo × mês, com o extrato
// calculado na hora, o status derivado e os envios registrados. Recebe o
// client (usuário sob RLS na página; admin nas actions e no cron).

import "server-only";

import { listCreditors, listEntries, type VbDb } from "@/lib/vb/queries";
import { buildMonthlyStatement, type MonthlyStatement } from "@/lib/vb/report/monthly-statement";
import { reportStatusFor, type VbReportStatus } from "@/lib/vb/report/status";
import type { VbEntry, VbReportSend } from "@/lib/vb/types";

export interface VbMonthlyReportRow {
  creditor: { id: string; name: string; email: string | null };
  statement: MonthlyStatement;
  status: VbReportStatus;
  /** Último envio oficial/reenvio do mês, se houver. */
  lastOfficial: VbReportSend | null;
  lastTest: VbReportSend | null;
  /**
   * O extrato de hoje difere do que foi enviado (lançamento retroativo ou
   * recálculo de rendimento depois do envio). Sinal para reenviar.
   */
  changedAfterSend: boolean;
}

type SendWithStatement = VbReportSend & {
  statement: Pick<MonthlyStatement, "closing_balance" | "rendimento"> | null;
};

export async function listReportSends(db: VbDb, month: string): Promise<SendWithStatement[]> {
  const { data, error } = await db
    .from("vb_report_sends")
    .select("id, creditor_id, month, kind, sent_to, sent_by, sent_at, subject, resend_id, statement")
    .eq("month", month)
    .order("sent_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as SendWithStatement[];
}

const CENT = 0.005;

function differs(sent: SendWithStatement["statement"], now: MonthlyStatement): boolean {
  if (!sent) return false;
  return (
    Math.abs(Number(sent.closing_balance) - now.closing_balance) > CENT ||
    Math.abs(Number(sent.rendimento) - now.rendimento) > CENT
  );
}

export async function loadMonthlyReportRows(db: VbDb, month: string): Promise<VbMonthlyReportRow[]> {
  const [creditors, entries, sends] = await Promise.all([
    listCreditors(db),
    listEntries(db, { status: "aprovado" }),
    listReportSends(db, month),
  ]);

  const byCreditor = new Map<string, VbEntry[]>();
  for (const entry of entries) {
    const list = byCreditor.get(entry.creditor_id) ?? [];
    list.push(entry);
    byCreditor.set(entry.creditor_id, list);
  }

  return creditors
    .filter((c) => c.active)
    .map((c) => {
      const statement = buildMonthlyStatement(byCreditor.get(c.id) ?? [], month);
      const mine = sends.filter((s) => s.creditor_id === c.id);
      const lastOfficial = mine.find((s) => s.kind !== "teste") ?? null;
      const lastTest = mine.find((s) => s.kind === "teste") ?? null;
      return {
        creditor: { id: c.id, name: c.name, email: c.email ?? null },
        statement,
        status: reportStatusFor({
          email: c.email ?? null,
          closingDate: statement.closing_date,
          lastYieldEnd: statement.last_yield_end,
          hadPositiveBalance: statement.had_positive_balance,
          hasOfficialSend: lastOfficial !== null,
        }),
        lastOfficial,
        lastTest,
        changedAfterSend: lastOfficial ? differs(lastOfficial.statement, statement) : false,
      };
    });
}
