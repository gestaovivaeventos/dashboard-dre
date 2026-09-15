import "server-only";

import { sendEmailViaResend } from "@/lib/email/resend";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any;

// URL de produção do Control Hub (mesma do lembrete de aprovações). Serve de
// fallback quando NEXT_PUBLIC_APP_URL não está definida — o e-mail vai para uma
// caixa real, então o link precisa ser SEMPRE absoluto e apontar para o app
// publicado (um link relativo virava "http:///chamados" no cliente de e-mail).
const FALLBACK_APP_URL = "https://controlhub.vivaeventos.com.br";

function baseUrl(): string {
  const env = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
  return env || FALLBACK_APP_URL;
}

function ticketLink(): string {
  return `${baseUrl()}/chamados`;
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

// Comentário do solicitante: vai só para o RESPONSÁVEL quando há um; sem
// responsável definido, cai para todos os admins.
export async function emailReplyToStaff(
  db: DB,
  t: { title: string; byName: string; assigneeEmail: string | null },
): Promise<void> {
  const to = t.assigneeEmail ? [t.assigneeEmail] : await adminEmails(db);
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

export async function emailAssigneeAssigned(
  db: DB,
  t: { assigneeEmail: string | null; title: string; byName: string },
): Promise<void> {
  if (!t.assigneeEmail) return;
  await safeSend({
    to: t.assigneeEmail,
    subject: `Você é o responsável pelo chamado: ${t.title}`,
    html: shell(
      "Chamado atribuído a você",
      `<p><strong>${esc(t.byName)}</strong> definiu você como responsável por:</p>
       <p style="padding:8px 12px;background:#f3f4f6;border-radius:6px">${esc(t.title)}</p>
       <p>A partir de agora, os e-mails deste chamado vêm só para você.</p>`,
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
