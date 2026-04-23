import { redirect } from "next/navigation";
import { Bell, Check } from "lucide-react";
import { revalidatePath } from "next/cache";

import { getCtrlUser } from "@/lib/ctrl/auth";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

async function getNotifications(userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ctrl_notifications")
    .select("id, title, message, type, is_read, created_at, request_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return { error: error.message };
  return { notifications: data ?? [] };
}

async function markAllRead(userId: string) {
  "use server";
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());
  await supabase
    .from("ctrl_notifications")
    .update({ is_read: true })
    .eq("user_id", userId)
    .eq("is_read", false);
  revalidatePath("/ctrl/notificacoes");
}

async function markOneRead(notifId: string) {
  "use server";
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());
  await supabase.from("ctrl_notifications").update({ is_read: true }).eq("id", notifId);
  revalidatePath("/ctrl/notificacoes");
}

const TYPE_STYLES: Record<string, string> = {
  aprovacao:           "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  rejeicao:            "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  pendente:            "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  info_solicitada:     "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  estorno:             "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  inativacao:          "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  fornecedor_pendente: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
};

export default async function NotificacoesPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  const { notifications = [], error } = await getNotifications(ctx.id);
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const markAll = markAllRead.bind(null, ctx.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notificações</h1>
          <p className="text-muted-foreground">
            {unreadCount > 0 ? `${unreadCount} não lida(s)` : "Tudo em dia!"}
          </p>
        </div>
        {unreadCount > 0 && (
          <form action={markAll}>
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
            >
              <Check className="h-4 w-4" />
              Marcar todas como lidas
            </button>
          </form>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <Bell className="mb-4 h-12 w-12 text-muted-foreground/40" />
          <h3 className="font-semibold">Nenhuma notificação</h3>
          <p className="mt-1 text-sm text-muted-foreground">Você estará informado aqui sobre suas requisições.</p>
        </div>
      ) : (
        <div className="divide-y rounded-lg border">
          {notifications.map((n) => {
            const markOne = markOneRead.bind(null, n.id);
            const typeStyle = TYPE_STYLES[n.type] ?? "bg-gray-100 text-gray-700";
            return (
              <div
                key={n.id}
                className={`flex items-start gap-4 px-4 py-3 transition-colors ${!n.is_read ? "bg-violet-50/50 dark:bg-violet-950/10" : ""}`}
              >
                {!n.is_read && (
                  <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-violet-600" />
                )}
                {n.is_read && <div className="mt-1.5 h-2 w-2 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{n.title}</span>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${typeStyle}`}>{n.type}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{n.message}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(n.created_at).toLocaleString("pt-BR")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {n.request_id && (
                    <a
                      href={`/ctrl/requisicoes`}
                      className="text-xs text-violet-600 hover:underline"
                    >
                      Ver
                    </a>
                  )}
                  {!n.is_read && (
                    <form action={markOne}>
                      <button type="submit" className="text-xs text-muted-foreground hover:text-foreground">
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    </form>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
