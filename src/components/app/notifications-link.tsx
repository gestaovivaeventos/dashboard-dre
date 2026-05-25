"use client";

import { Bell } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NotificationsLinkProps {
  visible: boolean;
  /** Contagem de notificações não lidas. Renderiza badge quando > 0. */
  unreadCount?: number;
}

export function NotificationsLink({ visible, unreadCount = 0 }: NotificationsLinkProps) {
  if (!visible) return null;
  const display = unreadCount > 99 ? "99+" : String(unreadCount);
  return (
    <Link
      href="/ctrl/notificacoes"
      aria-label={
        unreadCount > 0
          ? `Notificações (${unreadCount} não lida${unreadCount === 1 ? "" : "s"})`
          : "Notificações"
      }
      title={
        unreadCount > 0
          ? `${unreadCount} notificação${unreadCount === 1 ? "" : "ões"} não lida${unreadCount === 1 ? "" : "s"}`
          : "Notificações"
      }
      className={cn(buttonVariants({ variant: "outline", size: "icon" }), "relative")}
    >
      <Bell className="h-5 w-5" />
      {unreadCount > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white shadow-sm ring-2 ring-surface-1"
        >
          {display}
        </span>
      )}
    </Link>
  );
}
