import { redirect } from "next/navigation";

import { VbMonthlyReports, type MonthlyReportRowView } from "@/components/vb/monthly-reports";
import { currentMonthBR, currentYearBR } from "@/lib/ctrl/datetime";
import { createClient } from "@/lib/supabase/server";
import { getVbUser } from "@/lib/vb/auth";
import { monthLabel } from "@/lib/vb/report/monthly-email";
import { loadMonthlyReportRows } from "@/lib/vb/report/queries";
import { isMonthKey, previousMonth } from "@/lib/vb/report/status";

export const dynamic = "force-dynamic";

/** Últimos 12 meses fechados, do mais recente ao mais antigo. */
function closedMonths(): string[] {
  let key = previousMonth(`${currentYearBR()}-${String(currentMonthBR()).padStart(2, "0")}`);
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    out.push(key);
    key = previousMonth(key);
  }
  return out;
}

export default async function VbReportsPage({ searchParams }: { searchParams: { mes?: string } }) {
  const user = await getVbUser();
  if (!user) redirect("/");
  if (user.role !== "gestor") redirect("/vb");

  const months = closedMonths();
  const month = isMonthKey(searchParams.mes) && months.includes(searchParams.mes) ? searchParams.mes : months[0];

  const db = await createClient();
  const rows = await loadMonthlyReportRows(db, month);
  const view: MonthlyReportRowView[] = rows.map((r) => ({
    creditorId: r.creditor.id,
    name: r.creditor.name,
    email: r.creditor.email,
    status: r.status,
    openingBalance: r.statement.opening_balance,
    closingBalance: r.statement.closing_balance,
    rendimento: r.statement.rendimento,
    lines: r.statement.lines.length,
    lastYieldEnd: r.statement.last_yield_end,
    closingDate: r.statement.closing_date,
    lastOfficial: r.lastOfficial ? { sentAt: r.lastOfficial.sent_at, sentTo: r.lastOfficial.sent_to } : null,
    lastTest: r.lastTest ? { sentAt: r.lastTest.sent_at } : null,
    changedAfterSend: r.changedAfterSend,
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink-primary">VB — Relatórios mensais</h1>
        <p className="text-sm text-ink-muted">
          Extrato do mês por credor, enviado por e-mail. Todo dia 5 o sistema avisa que o mês anterior está
          disponível; o envio é sempre um clique seu.
        </p>
      </div>
      <VbMonthlyReports
        month={month}
        months={months.map((key) => ({ key, label: monthLabel(key) }))}
        rows={view}
      />
    </div>
  );
}
