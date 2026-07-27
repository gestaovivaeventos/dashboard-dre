import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3, Building2, ChevronRight, GitBranch, Table2, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { SegmentSelector } from "@/components/app/segment-selector";
import { getCurrentSessionContext } from "@/lib/auth/session";
import type { Segment } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

interface ConfiguracoesPageProps {
  params: Promise<{ segmentSlug: string }>;
}

interface ConfigCard {
  title: string;
  description: string;
  slug: string;
  icon: LucideIcon;
}

// Telas de configuração do módulo Financeiro, agrupadas neste hub (admin-only).
const CARDS: ConfigCard[] = [
  {
    title: "Estrutura DRE",
    description: "Plano de contas do DRE e mapeamento de categorias Omie.",
    slug: "estrutura-dre",
    icon: Table2,
  },
  {
    title: "Estrutura Fluxo de Caixa",
    description: "Plano de contas do Fluxo de Caixa e mapeamento de categorias Omie.",
    slug: "fluxo-de-caixa",
    icon: GitBranch,
  },
  {
    title: "KPIs",
    description: "Definições de indicadores calculados a partir das contas do DRE.",
    slug: "kpis",
    icon: BarChart3,
  },
  {
    title: "Departamentos",
    description: "Departamentos sincronizados da Omie por empresa e seu roteamento.",
    slug: "departamentos",
    icon: Building2,
  },
  {
    title: "Sócios",
    description: "Sócios por empresa e seus vínculos para dividendos e aportes.",
    slug: "socios",
    icon: Users,
  },
];

export default async function ConfiguracoesPage({ params }: ConfiguracoesPageProps) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    redirect("/login");
  }
  if (!profile || profile.role !== "admin") {
    redirect("/dashboard");
  }

  const { segmentSlug } = await params;

  const { data: allSegments } = await supabase
    .from("segments")
    .select("id,name,slug,display_order,active")
    .eq("active", true)
    .order("display_order");
  const segments = (allSegments as Segment[] | null) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground">
          Estruturas e cadastros administrativos do módulo Financeiro.
        </p>
      </div>

      {segments.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-ink-secondary">Segmento:</span>
          <SegmentSelector segments={segments} activeSlug={segmentSlug} />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.slug}
              href={`/s/${segmentSlug}/configuracoes/${card.slug}`}
              className="group flex items-start gap-4 rounded-lg border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-muted/40"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground group-hover:text-foreground">
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 font-semibold">
                  {card.title}
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{card.description}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
