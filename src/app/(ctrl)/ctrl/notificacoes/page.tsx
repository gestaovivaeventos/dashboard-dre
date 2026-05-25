import { redirect } from "next/navigation";
import { Bell, Check } from "lucide-react";

import { NotificationItem } from "@/components/ctrl/notification-item";
import { getCtrlUser } from "@/lib/ctrl/auth";
import {
  markAllNotificationsRead,
} from "@/lib/ctrl/actions/notifications";
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

const TYPE_STYLES: Record<string, string> = {
  aprovacao:                  "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  rejeicao:                   "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  pendente:                   "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  info_solicitada:            "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  info_pagamento_solicitada:  "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  info_pagamento_respondida:  "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  estorno:                    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  inativacao:                 "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  fornecedor_pendente:        "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
};

// Define a rota apropriada conforme o tipo da notificação.
// Ex: "info_pagamento_respondida" pinga o contas_a_pagar pra finalizar o envio.
function destinationFor(type: string, requestId: string | null): string | null {
  if (!requestId) return null;
  if (type === "info_pagamento_respondida") return "/ctrl/contas-a-pagar";
  if (type === "info_pagamento_solicitada") return "/ctrl/requisicoes";
  return "/ctrl/requisicoes";
}

// Wrapper de Server Action: <form action> exige (formData) => void | Promise<void>,
// mas markAllNotificationsRead retorna {error}|{ok}. Descartamos o retorno aqui.
async function markAllAction() {
  "use server";
  await markAllNotificationsRead();
}

export default async function NotificacoesPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  const { notifications = [], error } = await getNotifications(ctx.id);
  const unreadCount = notifications.filter((n) => !n.is_read).length;

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
          <form action={markAllAction}>
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
          {notifications.map((n) => (
            <NotificationItem
              key={n.id}
              id={n.id}
              title={n.title}
              message={n.message}
              type={n.type}
              isRead={n.is_read}
              createdAt={n.created_at}
              requestId={n.request_id}
              typeClassName={TYPE_STYLES[n.type] ?? "bg-gray-100 text-gray-700"}
              destinationHref={destinationFor(n.type, n.request_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
