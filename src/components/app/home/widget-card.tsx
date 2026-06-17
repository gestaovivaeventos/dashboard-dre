"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function WidgetCard({
  title,
  icon: Icon,
  href,
  hrefLabel = "Ver tudo",
  children,
}: {
  title: string;
  icon: LucideIcon;
  href: string;
  hrefLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="rounded-lg border bg-background">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Icon className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {hrefLabel}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function WidgetEmpty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-center text-sm text-muted-foreground">{children}</p>;
}
