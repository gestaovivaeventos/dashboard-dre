import "server-only";

import { sendEmailViaResend } from "@/lib/email/resend";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any;

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");

function ticketLink(): string {
  return APP_URL ? `${APP_URL}/chamados` : "/chamados";
}

function shell(title: string, bodyHtml: string): string {
  const link = ticketLink();
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;line-height:1.5">
      <h2 style="font-size:16px;margin:0 0 12px">${title}</h2>
      ${bodyHtml}
      <p style="margin:16px 0 0">
        <a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:8px 16px;border-radius:6px;font-weight:600">Abrir Chamados</a>
      </p>
      <p style="margin:16px 0 0;color:#6b7280;font-size:12px">Control Hub · Chamados</p>
    </div>`;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** E-mails dos admins ativos (role='admin'). */
async function adminEmails(db: DB): Promise<string[]> {
  const { data } = await db
    .from("users")
    .select("email")
    .eq("role", "admin")
    .eq("active", true);
  return (data ?? [])
    .map((u: { email: string | null }) => u.email)
    .filter((e: string | null): e is string => !!e);
}

// Best-effort: um e-mail que falhe nunca derruba a ação do chamado.
async function safeSend(args: Parameters<typeof sendEmailViaResend>[0]): Promise<void> {
  try {
    const res = await sendEmailViaResend(args);
    if (!res.ok) console.error("[support/email]", res.error);
  } catch (e) {
    console.error("[support/email] falha", e);
  }
}

export async function emailAdminsNewTicket(
  db: DB,
  t: { title: string; authorName: string; category: string },
): Promise<void> {
  const to = await adminEmails(db);
  if (to.length === 0) return;
  await safeSend({
    to,
    subject: `Novo chamado: ${t.title}`,
    html: shell(
      "Novo chamado aberto",
      `<p><strong>${esc(t.authorName)}</strong> abriu um chamado (${esc(t.category)}):</p>
       <p style="padding:8px 12px;background:#f3f4f6;border-radius:6px">${esc(t.title)}</p>`,
    ),
  });
}

export async function emailAuthorReply(
  db: DB,
  t: { authorEmail: string | null; title: string; byName: string },
): Promise<void> {
  if (!t.authorEmail) return;
  await safeSend({
    to: t.authorEmail,
    subject: `Resposta no seu chamado: ${t.title}`,
    html: shell(
      "Seu chamado teve uma resposta",
      `<p><strong>${esc(t.byName)}</strong> respondeu no chamado:</p>
       <p style="padding:8px 12px;background:#f3f4f6;border-radius:6px">${esc(t.title)}</p>`,
    ),
  });
}

export async function emailAdminsReply(
  db: DB,
  t: { title: string; byName: string },
): Promise<void> {
  const to = await adminEmails(db);
  if (to.length === 0) return;
  await safeSend({
    to,
    subject: `Novo comentário no chamado: ${t.title}`,
    html: shell(
      "Novo comentário do solicitante",
      `<p><strong>${esc(t.byName)}</strong> comentou no chamado:</p>
       <p style="padding:8px 12px;background:#f3f4f6;border-radius:6px">${esc(t.title)}</p>`,
    ),
  });
}

export async function emailAuthorStatus(
  db: DB,
  t: { authorEmail: string | null; title: string; statusLabel: string },
): Promise<void> {
  if (!t.authorEmail) return;
  await safeSend({
    to: t.authorEmail,
    subject: `Status atualizado: ${t.title}`,
    html: shell(
      "O status do seu chamado mudou",
      `<p>O chamado abaixo agora está como <strong>${esc(t.statusLabel)}</strong>:</p>
       <p style="padding:8px 12px;background:#f3f4f6;border-radius:6px">${esc(t.title)}</p>`,
    ),
  });
}
