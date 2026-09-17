"use server";

import { revalidatePath } from "next/cache";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  emailAdminsNewTicket,
  emailAssigneeAssigned,
  emailAuthorReply,
  emailAuthorStatus,
  emailReplyToStaff,
} from "@/lib/support/emails";
import {
  TICKET_STATUS_LABEL,
  type SupportAdmin,
  type TicketAttachment,
  type TicketAuthor,
  type TicketCategory,
  type TicketDetail,
  type TicketListItem,
  type TicketMessage,
  type TicketPriority,
  type TicketStatus,
} from "@/lib/support/types";

const TICKET_SELECT =
  "id, ticket_number, title, category, status, priority, created_at, updated_at, created_by, assignee_id, " +
  "author:users!support_tickets_created_by_fkey(name, email), " +
  "assignee:users!support_tickets_assignee_id_fkey(name, email)";

// Admin da plataforma: enxerga e gerencia todos os chamados.
function isSupportAdmin(profile: { profile?: string | null; role?: string | null } | null): boolean {
  return profile?.profile === "admin" || profile?.role === "admin";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normAuthor(a: any): TicketAuthor | null {
  const u = Array.isArray(a) ? a[0] ?? null : a;
  return u ? { name: u.name ?? null, email: u.email ?? null } : null;
}

// ─── createTicket ─────────────────────────────────────────────────────────────

export async function createTicket(data: {
  title: string;
  description: string;
  category: TicketCategory;
  attachments?: { path: string; name: string; mime?: string; size?: number }[];
}): Promise<{ ok: true; ticketId: string } | { error: string }> {
  const { user, profile } = await getCurrentSessionContext();
  if (!user) return { error: "Sessão expirada — refaça o login." };

  const title = data.title?.trim();
  const description = data.description?.trim();
  if (!title) return { error: "Informe o título do chamado." };
  if (!description) return { error: "Descreva o chamado." };
  const category: TicketCategory = data.category === "bug" ? "bug" : "melhoria";

  const db = createAdminClientIfAvailable() ?? (await createClient());
  const userId = profile?.id ?? user.id;

  const { data: ticket, error } = await db
    .from("support_tickets")
    .insert({ created_by: userId, title, description, category, status: "aberto" })
    .select("id")
    .single();

  if (error || !ticket) return { error: error?.message ?? "Falha ao abrir o chamado." };

  const atts = (data.attachments ?? []).filter((a) => a.path);
  if (atts.length > 0) {
    const { error: aErr } = await db.from("support_ticket_attachments").insert(
      atts.map((a) => ({
        ticket_id: ticket.id,
        path: a.path,
        name: a.name,
        mime: a.mime ?? null,
        size: a.size ?? null,
        uploaded_by: userId,
      })),
    );
    // Um anexo que falhe não derruba o chamado — ele já existe e o usuário pode
    // reanexar depois. Só registra.
    if (aErr) console.error("createTicket: falha ao gravar anexos", aErr);
  }

  // Avisa os admins do novo chamado (best-effort — não derruba a criação).
  await emailAdminsNewTicket(db, {
    title,
    authorName: profile?.name ?? user.email ?? "Usuário",
    category: category === "bug" ? "Bug" : "Melhoria",
  });

  revalidatePath("/chamados");
  return { ok: true, ticketId: ticket.id as string };
}

// ─── getTickets ───────────────────────────────────────────────────────────────

export async function getTickets(): Promise<
  { ok: true; isAdmin: boolean; tickets: TicketListItem[] } | { error: string }
> {
  const { user, profile } = await getCurrentSessionContext();
  if (!user) return { error: "Sessão expirada — refaça o login." };

  const admin = isSupportAdmin(profile);
  const db = createAdminClientIfAvailable() ?? (await createClient());

  let query = db
    .from("support_tickets")
    .select(TICKET_SELECT)
    .order("ticket_number", { ascending: false });
  // Usuário comum vê só os próprios; admin vê todos.
  if (!admin) query = query.eq("created_by", profile?.id ?? user.id);

  const { data, error } = await query;
  if (error) return { error: error.message };

  const tickets: TicketListItem[] = (data ?? []).map(toListItem);

  return { ok: true, isAdmin: admin, tickets };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toListItem(t: any): TicketListItem {
  return {
    id: t.id as string,
    ticket_number: Number(t.ticket_number),
    title: t.title as string,
    category: t.category as TicketCategory,
    status: t.status as TicketStatus,
    priority: (t.priority as TicketPriority | null) ?? null,
    created_at: t.created_at as string,
    updated_at: t.updated_at as string,
    author: normAuthor(t.author),
    assignee_id: (t.assignee_id as string | null) ?? null,
    assignee: normAuthor(t.assignee),
  };
}

// ─── getTicket ────────────────────────────────────────────────────────────────

export async function getTicket(
  id: string,
): Promise<
  | { ok: true; isAdmin: boolean; ticket: TicketDetail; attachments: TicketAttachment[]; messages: TicketMessage[] }
  | { error: string }
> {
  const { user, profile } = await getCurrentSessionContext();
  if (!user) return { error: "Sessão expirada — refaça o login." };

  const admin = isSupportAdmin(profile);
  const db = createAdminClientIfAvailable() ?? (await createClient());
  const userId = profile?.id ?? user.id;

  const { data: t, error } = await db
    .from("support_tickets")
    .select(`${TICKET_SELECT}, description`)
    .eq("id", id)
    .maybeSingle();

  if (error) return { error: error.message };
  if (!t) return { error: "Chamado não encontrado." };
  // Usuário comum só acessa o próprio chamado.
  if (!admin && t.created_by !== userId) return { error: "Você não tem acesso a este chamado." };

  const { data: attRows } = await db
    .from("support_ticket_attachments")
    .select("id, path, name, mime, size")
    .eq("ticket_id", id)
    .is("message_id", null)
    .order("created_at", { ascending: true });

  const attachments: TicketAttachment[] = [];
  for (const a of attRows ?? []) {
    const { data: signed } = await db.storage
      .from("support-attachments")
      .createSignedUrl(a.path as string, 60 * 10);
    attachments.push({
      id: a.id as string,
      name: a.name as string,
      mime: (a.mime as string | null) ?? null,
      size: (a.size as number | null) ?? null,
      url: signed?.signedUrl ?? null,
    });
  }

  const { data: msgRows } = await db
    .from("support_ticket_messages")
    .select("id, body, created_at, user_id, author:users!support_ticket_messages_user_id_fkey(name, email)")
    .eq("ticket_id", id)
    .order("created_at", { ascending: true });

  const messages: TicketMessage[] = (msgRows ?? []).map((m) => ({
    id: m.id as string,
    body: m.body as string,
    created_at: m.created_at as string,
    author: normAuthor((m as { author: unknown }).author),
    fromRequester: m.user_id === t.created_by,
  }));

  const ticket: TicketDetail = {
    ...toListItem(t),
    description: t.description as string,
  };

  return { ok: true, isAdmin: admin, ticket, attachments, messages };
}

// ─── addTicketMessage ─────────────────────────────────────────────────────────

export async function addTicketMessage(
  ticketId: string,
  body: string,
): Promise<{ ok: true } | { error: string }> {
  const { user, profile } = await getCurrentSessionContext();
  if (!user) return { error: "Sessão expirada — refaça o login." };
  const text = body?.trim();
  if (!text) return { error: "Escreva uma mensagem." };

  const admin = isSupportAdmin(profile);
  const db = createAdminClientIfAvailable() ?? (await createClient());
  const userId = profile?.id ?? user.id;

  const { data: t } = await db
    .from("support_tickets")
    .select(
      "id, title, status, created_by, author:users!support_tickets_created_by_fkey(name, email), assignee:users!support_tickets_assignee_id_fkey(name, email)",
    )
    .eq("id", ticketId)
    .maybeSingle();
  if (!t) return { error: "Chamado não encontrado." };
  const isRequester = t.created_by === userId;
  if (!admin && !isRequester) return { error: "Você não tem acesso a este chamado." };

  const now = new Date().toISOString();
  const { error } = await db
    .from("support_ticket_messages")
    .insert({ ticket_id: ticketId, user_id: userId, body: text });
  if (error) return { error: error.message };

  // O solicitante responde e o chamado estava "Aguardando resposta" → volta para
  // a fila da equipe ("Em análise"). A equipe controla os demais status na mão.
  if (isRequester && t.status === "aguardando_resposta") {
    await db.from("support_tickets").update({ status: "em_analise", updated_at: now }).eq("id", ticketId);
  }

  const byName = profile?.name ?? user.email ?? "Usuário";
  if (isRequester) {
    // Só o responsável recebe; sem responsável, todos os admins.
    await emailReplyToStaff(db, {
      title: t.title as string,
      byName,
      assigneeEmail: normAuthor((t as { assignee: unknown }).assignee)?.email ?? null,
    });
  } else {
    await emailAuthorReply(db, {
      authorEmail: normAuthor((t as { author: unknown }).author)?.email ?? null,
      title: t.title as string,
      byName,
    });
  }

  revalidatePath("/chamados");
  return { ok: true };
}

// ─── updateTicketStatus (admin) ───────────────────────────────────────────────

export async function updateTicketStatus(
  ticketId: string,
  status: TicketStatus,
): Promise<{ ok: true } | { error: string }> {
  const { user, profile } = await getCurrentSessionContext();
  if (!user) return { error: "Sessão expirada — refaça o login." };
  if (!isSupportAdmin(profile)) return { error: "Apenas administradores mudam o status." };
  if (!(status in TICKET_STATUS_LABEL)) return { error: "Status inválido." };

  const db = createAdminClientIfAvailable() ?? (await createClient());
  const now = new Date().toISOString();

  const { data: t } = await db
    .from("support_tickets")
    .select("id, title, author:users!support_tickets_created_by_fkey(name, email)")
    .eq("id", ticketId)
    .maybeSingle();
  if (!t) return { error: "Chamado não encontrado." };

  const patch: Record<string, unknown> = { status, updated_at: now };
  patch.resolved_at = status === "resolvido" ? now : null;
  patch.closed_at = status === "fechado" ? now : null;

  const { error } = await db.from("support_tickets").update(patch).eq("id", ticketId);
  if (error) return { error: error.message };

  await emailAuthorStatus(db, {
    authorEmail: normAuthor((t as { author: unknown }).author)?.email ?? null,
    title: t.title as string,
    statusLabel: TICKET_STATUS_LABEL[status],
  });

  revalidatePath("/chamados");
  return { ok: true };
}

// ─── setTicketPriority (admin) ────────────────────────────────────────────────

export async function setTicketPriority(
  ticketId: string,
  priority: TicketPriority | null,
): Promise<{ ok: true } | { error: string }> {
  const { user, profile } = await getCurrentSessionContext();
  if (!user) return { error: "Sessão expirada — refaça o login." };
  if (!isSupportAdmin(profile)) return { error: "Apenas administradores mudam a prioridade." };
  const p = priority || null;
  if (p && !["baixa", "media", "alta"].includes(p)) return { error: "Prioridade inválida." };

  const db = createAdminClientIfAvailable() ?? (await createClient());
  const { error } = await db
    .from("support_tickets")
    .update({ priority: p, updated_at: new Date().toISOString() })
    .eq("id", ticketId);
  if (error) return { error: error.message };

  revalidatePath("/chamados");
  return { ok: true };
}

// ─── getSupportAdmins ─────────────────────────────────────────────────────────

// Admins ativos — opções de "Responsável" no chamado (só admin consulta).
export async function getSupportAdmins(): Promise<{ ok: true; admins: SupportAdmin[] } | { error: string }> {
  const { user, profile } = await getCurrentSessionContext();
  if (!user) return { error: "Sessão expirada — refaça o login." };
  if (!isSupportAdmin(profile)) return { error: "Apenas administradores." };

  const db = createAdminClientIfAvailable() ?? (await createClient());
  const { data, error } = await db
    .from("users")
    .select("id, name, email")
    .eq("role", "admin")
    .eq("active", true)
    .order("name");
  if (error) return { error: error.message };

  return {
    ok: true,
    admins: (data ?? []).map((u) => ({
      id: u.id as string,
      name: (u.name as string | null) ?? null,
      email: (u.email as string | null) ?? null,
    })),
  };
}

// ─── setTicketAssignee (admin) ────────────────────────────────────────────────

export async function setTicketAssignee(
  ticketId: string,
  assigneeId: string | null,
): Promise<{ ok: true } | { error: string }> {
  const { user, profile } = await getCurrentSessionContext();
  if (!user) return { error: "Sessão expirada — refaça o login." };
  if (!isSupportAdmin(profile)) return { error: "Apenas administradores definem o responsável." };

  const db = createAdminClientIfAvailable() ?? (await createClient());
  const now = new Date().toISOString();

  let assigneeEmail: string | null = null;
  if (assigneeId) {
    const { data: a } = await db
      .from("users")
      .select("id, name, email, role, active")
      .eq("id", assigneeId)
      .maybeSingle();
    if (!a || a.role !== "admin" || !a.active) {
      return { error: "Responsável inválido — escolha um administrador ativo." };
    }
    assigneeEmail = (a.email as string | null) ?? null;
  }

  const { data: t } = await db.from("support_tickets").select("id, title").eq("id", ticketId).maybeSingle();
  if (!t) return { error: "Chamado não encontrado." };

  const { error } = await db
    .from("support_tickets")
    .update({ assignee_id: assigneeId, updated_at: now })
    .eq("id", ticketId);
  if (error) return { error: error.message };

  if (assigneeId) {
    await emailAssigneeAssigned(db, {
      assigneeEmail,
      title: t.title as string,
      byName: profile?.name ?? user.email ?? "Administrador",
    });
  }

  revalidatePath("/chamados");
  return { ok: true };
}
