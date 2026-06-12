import { NextResponse } from "next/server";

import { sendEmail } from "@/lib/email/gmail";
import { analyzeOnePageReport } from "@/lib/financeiro/relatorios/one-page-analyzer";
import { renderOnePageEmail } from "@/lib/financeiro/relatorios/one-page-email";
import { buildOnePagePayload } from "@/lib/financeiro/relatorios/one-page-payload";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// GET /api/cron/monthly-bi-report
//
// Envia o One Page Report (Business Intelligence) do MES ANTERIOR por email
// para os gestores assinantes de cada unidade (tabela bi_report_subscriptions,
// gerenciada em /admin/relatorios-bi). Agendado no vercel.json para o dia 5
// de cada mes — margem para o fechamento do Omie ser sincronizado.
//
// Reusa exatamente o mesmo pipeline da tela /financeiro/business-intelligence:
// buildOnePagePayload (numeros) → analyzeOnePageReport (IA) → email HTML.
// ============================================================================

export const runtime = "nodejs";
export const maxDuration = 300;

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

function getPreviousMonthRange(now: Date): { dateFrom: string; dateTo: string; periodLabel: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const prevMonthIndex = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const prevMonth1 = prevMonthIndex + 1;
  const lastDay = new Date(Date.UTC(prevYear, prevMonthIndex + 1, 0)).getUTCDate();

  return {
    dateFrom: `${prevYear}-${String(prevMonth1).padStart(2, "0")}-01`,
    dateTo: `${prevYear}-${String(prevMonth1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    periodLabel: `${MONTH_NAMES[prevMonthIndex]} ${prevYear}`,
  };
}

interface SubscriptionRow {
  company_id: string;
  users: { email: string; name: string | null; active: boolean } | null;
  companies: { id: string; name: string; active: boolean } | null;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { dateFrom, dateTo, periodLabel } = getPreviousMonthRange(new Date());
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  // Assinaturas ativas com usuario e empresa ativos.
  const { data: subsData, error: subsError } = await admin
    .from("bi_report_subscriptions")
    .select("company_id, users!bi_report_subscriptions_user_id_fkey(email,name,active), companies!bi_report_subscriptions_company_id_fkey(id,name,active)")
    .eq("active", true);

  if (subsError) {
    return NextResponse.json({ error: subsError.message }, { status: 400 });
  }

  // Agrupa emails por empresa, descartando usuarios/empresas inativos.
  const byCompany = new Map<string, { companyName: string; emails: Set<string> }>();
  for (const row of (subsData ?? []) as unknown as SubscriptionRow[]) {
    if (!row.users?.active || !row.companies?.active) continue;
    const entry = byCompany.get(row.company_id) ?? { companyName: row.companies.name, emails: new Set<string>() };
    entry.emails.add(row.users.email);
    byCompany.set(row.company_id, entry);
  }

  const results: Array<{ companyId: string; companyName: string; ok: boolean; recipients?: number; error?: string }> = [];
  const failures: Array<{ companyName: string; error: string }> = [];

  for (const [companyId, { companyName, emails }] of Array.from(byCompany.entries())) {
    try {
      const result = await buildOnePagePayload(admin, { companyId, dateFrom, dateTo, periodLabel });
      if (!result.ok) throw new Error(result.error);

      const analysis = await analyzeOnePageReport(result.payload.input);
      const html = renderOnePageEmail({
        companyName,
        periodLabel,
        payload: result.payload,
        analysis,
        appUrl,
      });

      const recipients = Array.from(emails);
      const sendResult = await sendEmail({
        to: recipients,
        subject: `[Controll Hub] Relatório BI — ${companyName} — ${periodLabel}`,
        html,
      });
      if (!sendResult.ok) throw new Error(sendResult.error ?? "Falha no envio do email.");

      await admin.from("ai_reports").insert({
        type: "one-page-monthly",
        company_ids: [companyId],
        period_from: dateFrom,
        period_to: dateTo,
        content_html: html,
        content_json: { analysis, ...result.payload } as unknown as Record<string, unknown>,
        recipients,
        sent_at: new Date().toISOString(),
        status: "sent",
      });

      results.push({ companyId, companyName, ok: true, recipients: recipients.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha inesperada ao gerar relatório.";
      failures.push({ companyName, error: message });
      results.push({ companyId, companyName, ok: false, error: message });

      await admin.from("ai_reports").insert({
        type: "one-page-monthly",
        company_ids: [companyId],
        period_from: dateFrom,
        period_to: dateTo,
        content_html: "",
        content_json: {},
        recipients: Array.from(emails),
        status: "error",
        error_message: message,
      });
    }
  }

  // Alerta o admin se houve falhas.
  if (failures.length > 0 && process.env.ADMIN_EMAIL) {
    const list = failures.map((f) => `<li><strong>${f.companyName}</strong>: ${f.error}</li>`).join("");
    await sendEmail({
      to: process.env.ADMIN_EMAIL,
      subject: `[Controll Hub] Falhas no Relatório BI mensal — ${periodLabel}`,
      html: `<h2>Falhas ao gerar o relatório BI mensal (${periodLabel})</h2><ul>${list}</ul>`,
    });
  }

  return NextResponse.json({
    ok: failures.length === 0,
    period: periodLabel,
    companies: byCompany.size,
    sent: results.filter((r) => r.ok).length,
    failed: failures.length,
    results,
  });
}
