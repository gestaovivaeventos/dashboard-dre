"use client";

import { Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { markNotificationRead } from "@/lib/ctrl/actions/notifications";

interface NotificationItemProps {
  id: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  createdAt: string;
  requestId: string | null;
  /** Estilo de pílula pro tipo (fica pintado conforme TYPE_STYLES do page). */
  typeClassName: string;
  /** Pra onde mandar quando o usuario clica e a notificacao tem request_id. */
  destinationHref: string | null;
}

export function NotificationItem({
  id,
  title,
  message,
  type,
  isRead,
  createdAt,
  requestId,
  typeClassName,
  destinationHref,
}: NotificationItemProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Otimismo local: ao clicar, ja escurece a marcacao sem esperar revalidacao
  // do server. Se a action falhar, voltamos pro estado anterior.
  const [optimisticRead, setOptimisticRead] = useState(isRead);

  function handleClick() {
    if (!optimisticRead) setOptimisticRead(true);
    startTransition(async () => {
      // Sempre marca como lida (action e' idempotente — se ja' estava lida,
      // o UPDATE nao muda nada).
      const result = await markNotificationRead(id);
      if ("error" in result && result.error) {
        // Reverte o otimismo
        setOptimisticRead(isRead);
        // eslint-disable-next-line no-console
        console.error("[notification] Falha ao marcar como lida:", result.error);
      }
      router.refresh();
      if (destinationHref) {
        router.push(destinationHref);
      }
    });
  }

  function handleCheckOnly(e: React.MouseEvent) {
    e.stopPropagation();
    if (optimisticRead) return;
    setOptimisticRead(true);
    startTransition(async () => {
      const result = await markNotificationRead(id);
      if ("error" in result && result.error) {
        setOptimisticRead(isRead);
      }
      router.refresh();
    });
  }

  const showAsUnread = !optimisticRead;
  const clickable = !optimisticRead || !!destinationHref;

  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? handleClick : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleClick();
              }
            }
          : undefined
      }
      className={`flex items-start gap-4 px-4 py-3 transition-colors ${
        showAsUnread ? "bg-violet-50/50 dark:bg-violet-950/10" : ""
      } ${clickable ? "cursor-pointer hover:bg-muted/40" : ""}`}
    >
      <div
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
          showAsUnread ? "bg-violet-600" : ""
        }`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{title}</span>
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${typeClassName}`}
          >
            {type}
          </span>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{message}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {new Date(createdAt).toLocaleString("pt-BR")}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {requestId && destinationHref && (
          <span className="text-xs text-violet-600">Ver →</span>
        )}
        {!optimisticRead && (
          <button
            type="button"
            onClick={handleCheckOnly}
            disabled={isPending}
            title="Marcar como lida"
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
