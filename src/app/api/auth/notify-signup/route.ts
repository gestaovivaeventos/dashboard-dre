import { NextResponse } from "next/server";

import { sendNewUserPendingApprovalEmail } from "@/lib/notifications/resend";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

// Janela em que um cadastro recém-criado ainda pode disparar o aviso ao admin.
const SIGNUP_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      email?: unknown;
      name?: unknown;
    };

    const userEmail = typeof body.email === "string" ? body.email.trim() : "";
    const userName = typeof body.name === "string" ? body.name.trim() || null : null;

    if (!userEmail) {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }

    // A rota é pública (quem acabou de se cadastrar ainda não tem sessão), então
    // só envia se o e-mail corresponde a um cadastro real feito há pouco — senão
    // qualquer um usaria o endpoint para inundar o ADMIN_EMAIL com texto arbitrário.
    const admin = createAdminClientIfAvailable();
    if (admin) {
      const { data: row } = await admin
        .from("users")
        .select("id, created_at")
        .ilike("email", userEmail)
        .maybeSingle();
      const createdAt = row?.created_at ? new Date(row.created_at).getTime() : 0;
      if (!row || Date.now() - createdAt > SIGNUP_WINDOW_MS) {
        return NextResponse.json({ ok: true });
      }
    }

    await sendNewUserPendingApprovalEmail({ userEmail, userName });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/auth/notify-signup] erro:", err);
    // Nunca quebra o fluxo de signup por causa de email.
    return NextResponse.json({ ok: true });
  }
}
