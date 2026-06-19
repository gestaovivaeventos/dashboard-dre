import { NextResponse } from "next/server";

import { sendEmail } from "@/lib/email/gmail";
import {
  getPreviousMonthRange,
  sendOnePageForCompany,
} from "@/lib/financeiro/relatorios/monthly-bi-sender";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// GET /api/cron/monthly-bi-report
//
// Envia o One Page Report (Business Intelligence) do MES ANTERIOR por email
// para os gestores assinantes de cada unidade (tabela bi_report_subscriptions,
// gerenciada em /admin/relatorios-bi). Agendado no vercel.json para o dia 5
// de cada mes — margem para o fechamento do Omie ser sincronizado.
//
// A geracao/envio em si vive em sendOnePageForCompany (compartilhado com o
// envio manual "Enviar agora").
// ============================================================================

export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
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
  const range = getPreviousMonthRange(new Date());
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
    const recipients = Array.from(emails);
    const res = await sendOnePageForCompany({ admin, companyId, companyName, emails: recipients, range, appUrl });
    if (res.ok) {
      results.push({ companyId, companyName, ok: true, recipients: recipients.length });
    } else {
      failures.push({ companyName, error: res.error ?? "Falha desconhecida." });
      results.push({ companyId, companyName, ok: false, error: res.error });
    }
  }

  // Alerta o admin se houve falhas.
  if (failures.length > 0 && process.env.ADMIN_EMAIL) {
    const list = failures.map((f) => `<li><strong>${f.companyName}</strong>: ${f.error}</li>`).join("");
    await sendEmail({
      to: process.env.ADMIN_EMAIL,
      subject: `[Control Hub] Falhas no Relatório BI mensal — ${range.periodLabel}`,
      html: `<h2>Falhas ao gerar o relatório BI mensal (${range.periodLabel})</h2><ul>${list}</ul>`,
    });
  }

  return NextResponse.json({
    ok: failures.length === 0,
    period: range.periodLabel,
    companies: byCompany.size,
    sent: results.filter((r) => r.ok).length,
    failed: failures.length,
    results,
  });
}
