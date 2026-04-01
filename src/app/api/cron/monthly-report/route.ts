import { NextResponse } from "next/server";

import { sendEmail } from "@/lib/email/gmail";
import { generateReport } from "@/lib/intelligence/generate-report";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Marco", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

function getPreviousMonthRange(now: Date): { dateFrom: string; dateTo: string; periodLabel: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed current month

  // Previous month (0-indexed)
  const prevMonthIndex = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;

  // 1-indexed for date strings
  const prevMonth1 = prevMonthIndex + 1;
  const lastDay = new Date(Date.UTC(prevYear, prevMonthIndex + 1, 0)).getUTCDate();

  const dateFrom = `${prevYear}-${String(prevMonth1).padStart(2, "0")}-01`;
  const dateTo = `${prevYear}-${String(prevMonth1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const periodLabel = `${MONTH_NAMES[prevMonthIndex]} ${prevYear}`;

  return { dateFrom, dateTo, periodLabel };
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const now = new Date();
  const { dateFrom, dateTo, periodLabel } = getPreviousMonthRange(now);

  // Fetch all active companies
  const { data: companies, error: companiesError } = await adminClient
    .from("companies")
    .select("id, name")
    .eq("active", true)
    .order("name");

  if (companiesError) {
    return NextResponse.json({ error: companiesError.message }, { status: 400 });
  }

  const results: Array<{
    companyId: string;
    companyName: string;
    ok: boolean;
    contactCount?: number;
    error?: string;
  }> = [];

  const failures: Array<{ companyId: string; companyName: string; error: string }> = [];

  for (const company of companies ?? []) {
    const companyId = company.id as string;
    const companyName = company.name as string;

    try {
      // Fetch active contacts for this company
      const { data: contacts, error: contactsError } = await adminClient
        .from("company_contacts")
        .select("email, name")
        .eq("company_id", companyId)
        .eq("active", true);

      if (contactsError) {
        throw new Error(`Erro ao buscar contatos: ${contactsError.message}`);
      }

      if (!contacts || contacts.length === 0) {
        results.push({
          companyId,
          companyName,
          ok: false,
          contactCount: 0,
          error: "Sem contatos cadastrados",
        });
        continue;
      }

      // Generate report
      const { html } = await generateReport({
        supabase: adminClient,
        companyIds: [companyId],
        dateFrom,
        dateTo,
        periodLabel,
      });

      // Send email to all contacts
      const emails = contacts.map((c: { email: string; name: string }) => c.email);
      await sendEmail({
        to: emails,
        subject: `[Controll Hub] Relatorio Mensal — ${companyName} — ${periodLabel}`,
        html,
      });

      // Save to ai_reports table
      await adminClient.from("ai_reports").insert({
        company_id: companyId,
        type: "relatorio",
        status: "sent",
        period_label: periodLabel,
        date_from: dateFrom,
        date_to: dateTo,
        recipient_emails: emails,
        created_at: new Date().toISOString(),
      });

      results.push({
        companyId,
        companyName,
        ok: true,
        contactCount: contacts.length,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha inesperada ao gerar relatorio.";

      failures.push({ companyId, companyName, error: message });
      results.push({ companyId, companyName, ok: false, error: message });

      // Save error to ai_reports table
      await adminClient.from("ai_reports").insert({
        company_id: companyId,
        type: "relatorio",
        status: "error",
        period_label: periodLabel,
        date_from: dateFrom,
        date_to: dateTo,
        error_message: message,
        created_at: new Date().toISOString(),
      }).then(() => {/* ignore insert errors */});
    }
  }

  // Send alert email to admin if any failures
  if (failures.length > 0) {
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      const failureList = failures
        .map((f) => `<li><strong>${f.companyName}</strong>: ${f.error}</li>`)
        .join("");
      await sendEmail({
        to: adminEmail,
        subject: `[Controll Hub] Falhas no Relatorio Mensal — ${periodLabel}`,
        html: `<h2>Falhas ao gerar relatório mensal (${periodLabel})</h2><ul>${failureList}</ul>`,
      });
    }
  }

  const sent = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  return NextResponse.json({
    ok: failures.length === 0,
    period: periodLabel,
    total: results.length,
    sent,
    failed,
    results,
  });
}
