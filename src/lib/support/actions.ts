"use server";

import { revalidatePath } from "next/cache";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type TicketCategory = "melhoria" | "bug";
export type TicketStatus =
  | "aberto"
  | "em_analise"
  | "aguardando_resposta"
  | "resolvido"
  | "fechado";
export type TicketPriority = "baixa" | "media" | "alta";

export interface TicketAuthor {
  name: string | null;
  email: string | null;
}

export interface TicketListItem {
  id: string;
  title: string;
  category: TicketCategory;
  status: TicketStatus;
  priority: TicketPriority | null;
  created_at: string;
  updated_at: string;
  author: TicketAuthor | null;
}

export interface TicketAttachment {
  id: string;
  name: string;
  mime: string | null;
  size: number | null;
  url: string | null;
}

export interface TicketDetail extends TicketListItem {
  description: string;
}

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
    .select(
      "id, title, category, status, priority, created_at, updated_at, created_by, author:users!support_tickets_created_by_fkey(name, email)",
    )
    .order("created_at", { ascending: false });
  // Usuário comum vê só os próprios; admin vê todos.
  if (!admin) query = query.eq("created_by", profile?.id ?? user.id);

  const { data, error } = await query;
  if (error) return { error: error.message };

  const tickets: TicketListItem[] = (data ?? []).map((t) => ({
    id: t.id as string,
    title: t.title as string,
    category: t.category as TicketCategory,
    status: t.status as TicketStatus,
    priority: (t.priority as TicketPriority | null) ?? null,
    created_at: t.created_at as string,
    updated_at: t.updated_at as string,
    author: normAuthor((t as { author: unknown }).author),
  }));

  return { ok: true, isAdmin: admin, tickets };
}

// ─── getTicket ────────────────────────────────────────────────────────────────

export async function getTicket(
  id: string,
): Promise<
  { ok: true; isAdmin: boolean; ticket: TicketDetail; attachments: TicketAttachment[] } | { error: string }
> {
  const { user, profile } = await getCurrentSessionContext();
  if (!user) return { error: "Sessão expirada — refaça o login." };

  const admin = isSupportAdmin(profile);
  const db = createAdminClientIfAvailable() ?? (await createClient());
  const userId = profile?.id ?? user.id;

  const { data: t, error } = await db
    .from("support_tickets")
    .select(
      "id, title, description, category, status, priority, created_at, updated_at, created_by, author:users!support_tickets_created_by_fkey(name, email)",
    )
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

  const ticket: TicketDetail = {
    id: t.id as string,
    title: t.title as string,
    description: t.description as string,
    category: t.category as TicketCategory,
    status: t.status as TicketStatus,
    priority: (t.priority as TicketPriority | null) ?? null,
    created_at: t.created_at as string,
    updated_at: t.updated_at as string,
    author: normAuthor((t as { author: unknown }).author),
  };

  return { ok: true, isAdmin: admin, ticket, attachments };
}
