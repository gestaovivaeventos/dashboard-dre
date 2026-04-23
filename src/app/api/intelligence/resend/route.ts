import { NextResponse } from "next/server";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/gmail";

interface ResendBody {
  reportId: string;
  emails?: string[];
}

function buildSubject(type: string): string {
  if (type === "relatorio") return "[Controll Hub] Relatorio Mensal";
  if (type === "comparativo") return "[Controll Hub] Comparativo de Empresas";
  if (type === "projecao") return "[Controll Hub] Projecoes Financeiras";
  return "[Controll Hub] Relatorio";
}

export async function POST(request: Request) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  const body = (await request.json()) as ResendBody;
  const { reportId, emails: providedEmails } = body;

  if (!reportId) {
    return NextResponse.json({ error: "reportId e obrigatorio." }, { status: 400 });
  }

  const adminClient = createAdminClient();

  const { data: report, error: fetchError } = await adminClient
    .from("ai_reports")
    .select("id, content_html, type, recipients")
    .eq("id", reportId)
    .single();

  if (fetchError || !report) {
    return NextResponse.json({ error: "Relatorio nao encontrado." }, { status: 404 });
  }

  const emails = providedEmails && providedEmails.length > 0
    ? providedEmails
    : (report.recipients as string[] | null) ?? [];

  if (emails.length === 0) {
    return NextResponse.json(
      { error: "Nenhum email destinatario informado." },
      { status: 400 }
    );
  }

  const subject = buildSubject(report.type as string);
  const result = await sendEmail({
    to: emails,
    subject,
    html: report.content_html as string,
  });

  if (!result.ok) {
    return NextResponse.json({ error: `Falha ao reenviar email: ${result.error}` }, { status: 500 });
  }

  await adminClient
    .from("ai_reports")
    .update({
      sent_at: new Date().toISOString(),
      recipients: emails,
      status: "sent",
    })
    .eq("id", reportId);

  return NextResponse.json({ ok: true });
}
