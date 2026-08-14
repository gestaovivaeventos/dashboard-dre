"use client";

import { Bell } from "lucide-react";
import Link from "next/link";

interface NotificationsLinkProps {
  visible: boolean;
  /** Contagem de notificações não lidas. Renderiza badge quando > 0. */
  unreadCount?: number;
  /**
   * Destino do sino. Default `/ctrl/notificacoes` (módulo Compras). Usuários
   * sem Compras — ex.: perfil CSC, que recebe a pendência de validação dos
   * relatórios — apontam para a tela onde a pendência se resolve.
   */
  href?: string;
}

export function NotificationsLink({
  visible,
  unreadCount = 0,
  href = "/ctrl/notificacoes",
}: NotificationsLinkProps) {
  if (!visible) return null;
  const display = unreadCount > 99 ? "99+" : String(unreadCount);
  return (
    <Link
      href={href}
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
      className="ch-iconbtn"
    >
      <Bell className="h-4 w-4" strokeWidth={2} />
      {unreadCount > 0 && (
        <span aria-hidden="true" className="ch-iconbtn__badge">
          {display}
        </span>
      )}
    </Link>
  );
}
