import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import {
  getPreviousMonthRange,
  sendOnePageForCompany,
} from "@/lib/financeiro/relatorios/monthly-bi-sender";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

// ============================================================================
// POST /api/bi-subscriptions/send  (admin)
//
// Envia AGORA o relatorio BI do mes anterior de uma assinatura especifica
// (uma unidade → um gestor). Util para testar e para reenvio pontual. Usa o
// mesmo pipeline do cron mensal (sendOnePageForCompany).
//
// Body: { id }  — id da linha em bi_report_subscriptions.
// ============================================================================

interface SendBody {
  id?: string;
}

export async function POST(request: Request) {
  const ctx = await getCurrentSessionContext();
  if (!ctx.user || !ctx.profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (ctx.profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as SendBody;
  if (!body.id) {
    return NextResponse.json({ error: "Campo obrigatorio: id." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: sub, error } = await admin
    .from("bi_report_subscriptions")
    .select("company_id, users!bi_report_subscriptions_user_id_fkey(email), companies!bi_report_subscriptions_company_id_fkey(id,name)")
    .eq("id", body.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!sub) {
    return NextResponse.json({ error: "Assinatura nao encontrada." }, { status: 404 });
  }

  const user = sub.users as unknown as { email: string } | null;
  const company = sub.companies as unknown as { id: string; name: string } | null;
  if (!user?.email || !company) {
    return NextResponse.json({ error: "Assinatura com usuário ou empresa inválidos." }, { status: 400 });
  }

  const result = await sendOnePageForCompany({
    admin,
    companyId: company.id,
    companyName: company.name,
    emails: [user.email],
    range: getPreviousMonthRange(new Date()),
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Falha ao enviar." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, sentTo: user.email });
}
