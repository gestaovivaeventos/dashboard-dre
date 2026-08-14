"use client";

import Link from "next/link";
import { Plus } from "lucide-react";

import { SectionHead, WidgetEmpty } from "@/components/app/home/widget-card";
import type { HomeMyRequests } from "@/lib/home/ctrl-widgets";

export function WidgetMinhasRequisicoes({ data }: { data: HomeMyRequests }) {
  return (
    <div>
      <SectionHead title="Minhas requisições" href="/ctrl/requisicoes" hrefLabel="Ver todas" />

      {data.total === 0 ? (
        <WidgetEmpty>Você ainda não criou requisições.</WidgetEmpty>
      ) : (
        <div className="ch-2col" style={{ gap: "12px 28px" }}>
          <Stat label="Pendentes" value={data.pendentes} />
          <Stat label="Info pedida" value={data.infoPendente} highlight={data.infoPendente > 0} />
          <Stat label="Aprovadas" value={data.aprovadas} />
          <Stat label="Rejeitadas" value={data.rejeitadas} />
        </div>
      )}

      <Link
        href="/ctrl/requisicoes/nova"
        className="ch-btn ch-btn--primary"
        style={{ marginTop: 16 }}
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
        Nova requisição
      </Link>
    </div>
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
    <div>
      <p className={`ch-metric ${highlight ? "ch-metric--accent" : ""}`}>{value}</p>
      <p className="ch-kicker" style={{ marginTop: 7 }}>
        {label}
      </p>
    </div>
  );
}
