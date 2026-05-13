"use client";

import { Bell } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NotificationsLinkProps {
  visible: boolean;
}

export function NotificationsLink({ visible }: NotificationsLinkProps) {
  if (!visible) return null;
  return (
    <Link
      href="/ctrl/notificacoes"
      aria-label="Notificacoes"
      title="Notificacoes"
      className={cn(buttonVariants({ variant: "outline", size: "icon" }))}
    >
      <Bell className="h-5 w-5" />
    </Link>
  );
}
