import { NextResponse } from "next/server";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/gmail";

interface SendBody {
  reportId: string;
  emails: string[];
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

  const body = (await request.json()) as SendBody;
  const { reportId, emails } = body;

  if (!reportId) {
    return NextResponse.json({ error: "reportId e obrigatorio." }, { status: 400 });
  }
  if (!emails || emails.length === 0) {
    return NextResponse.json({ error: "emails nao pode ser vazio." }, { status: 400 });
  }

  const adminClient = createAdminClient();

  const { data: report, error: fetchError } = await adminClient
    .from("ai_reports")
    .select("id, content_html, type")
    .eq("id", reportId)
    .single();

  if (fetchError || !report) {
    return NextResponse.json({ error: "Relatorio nao encontrado." }, { status: 404 });
  }

  const subject = buildSubject(report.type as string);
  const result = await sendEmail({
    to: emails,
    subject,
    html: report.content_html as string,
  });

  if (result.ok) {
    await adminClient
      .from("ai_reports")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        recipients: emails,
      })
      .eq("id", reportId);
  } else {
    await adminClient
      .from("ai_reports")
      .update({ status: "error" })
      .eq("id", reportId);

    return NextResponse.json({ error: `Falha ao enviar email: ${result.error}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
