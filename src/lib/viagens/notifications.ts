import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any>;

/** Notifica todos os aprovadores de viagens (can_viagens_aprovar) + admins. */
export async function notifyViagemAprovadores(
  db: DB,
  params: { requestId: string; title: string; message: string; type?: string },
): Promise<void> {
  const { data: users } = await db
    .from("users")
    .select("id, profile, role, can_viagens_aprovar, active")
    .eq("active", true);

  const targets = ((users ?? []) as Array<{ id: string; profile: string | null; role: string | null; can_viagens_aprovar: boolean | null }>)
    .filter((u) => u.can_viagens_aprovar || u.profile === "admin" || u.role === "admin")
    .map((u) => u.id);

  if (targets.length === 0) return;
  await db.from("viagem_notifications").insert(
    targets.map((userId) => ({
      user_id: userId,
      request_id: params.requestId,
      title: params.title,
      message: params.message,
      type: params.type ?? "pendente",
    })),
  );
}

/** Notifica um usuário específico (ex.: o solicitante). */
export async function notifyViagemUser(
  db: DB,
  params: { userId: string; requestId: string; title: string; message: string; type?: string },
): Promise<void> {
  await db.from("viagem_notifications").insert({
    user_id: params.userId,
    request_id: params.requestId,
    title: params.title,
    message: params.message,
    type: params.type ?? "info",
  });
}
