import { NextResponse } from "next/server";

import { sendNewUserPendingApprovalEmail } from "@/lib/notifications/resend";

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

    await sendNewUserPendingApprovalEmail({ userEmail, userName });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/auth/notify-signup] erro:", err);
    // Nunca quebra o fluxo de signup por causa de email.
    return NextResponse.json({ ok: true });
  }
}
