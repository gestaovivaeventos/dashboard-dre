"use client";

import Link from "next/link";
import { FileText, Plus } from "lucide-react";

import { WidgetCard, WidgetEmpty } from "@/components/app/home/widget-card";
import type { HomeMyRequests } from "@/lib/home/ctrl-widgets";

export function WidgetMinhasRequisicoes({ data }: { data: HomeMyRequests }) {
  return (
    <WidgetCard
      title="Minhas requisições"
      icon={FileText}
      href="/ctrl/requisicoes"
      hrefLabel="Ver todas"
    >
      {data.total === 0 ? (
        <WidgetEmpty>Você ainda não criou requisições.</WidgetEmpty>
      ) : (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Stat label="Pendentes" value={data.pendentes} />
          <Stat label="Info pedida" value={data.infoPendente} highlight={data.infoPendente > 0} />
          <Stat label="Aprovadas" value={data.aprovadas} />
          <Stat label="Rejeitadas" value={data.rejeitadas} />
        </div>
      )}
      <Link
        href="/ctrl/requisicoes/nova"
        className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <Plus className="h-3.5 w-3.5" />
        Nova requisição
      </Link>
    </WidgetCard>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <p className={`text-lg font-bold ${highlight ? "text-amber-600" : ""}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
