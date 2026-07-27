import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Building2,
  ChevronRight,
  MapPinned,
  Percent,
  SlidersHorizontal,
  Tags,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { getCurrentSessionContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

interface ConfigCard {
  title: string;
  description: string;
  icon: LucideIcon;
  /** Destino da tela. Ausente enquanto a tela ainda não foi construída. */
  href?: string;
}

// Telas de configuração do módulo Orçamento, agrupadas neste hub (admin-only).
// Cada card sem `href` ainda está por construir e aparece como "Em breve" —
// basta adicionar o `href` (e criar a rota) para ativá-lo, conforme cada tela
// for entregue.
const CARDS: ConfigCard[] = [
  {
    title: "Orçar por setor",
    description:
      "Liga ou desliga o detalhamento por setor em cada empresa. Empresas sem essa opção orçam apenas por categoria.",
    icon: SlidersHorizontal,
    href: "/orcamento/configuracoes/orcar-por-setor",
  },
  {
    title: "Setores",
    description:
      "Cadastro dos setores usados para organizar o orçamento. Independente do departamento da Omie.",
    icon: Building2,
    href: "/orcamento/configuracoes/setores",
  },
  {
    title: "Índices de correção",
    description:
      "Cadastro dos índices de reajuste reutilizados pelas despesas por média, por valor fixo e do planejamento dos sócios.",
    icon: Percent,
    href: "/orcamento/configuracoes/indices",
  },
  {
    title: "Estrutura DRE",
    description:
      "Reaproveita a estrutura de DRE já cadastrada de cada empresa. A linha do orçamento é derivada da categoria pelo mapeamento existente.",
    icon: MapPinned,
  },
  {
    title: "Plano de cargos e salários",
    description:
      "Cargos e seus níveis (Jr/Pl/Sr), cada um com salário-base, usados no orçamento de despesas com pessoal.",
    icon: Users,
    href: "/orcamento/configuracoes/plano-cargos",
  },
  {
    title: "Categorias do planejamento dos sócios",
    description:
      "Categorias que dependem do planejamento dos sócios, usadas na entrevista guiada por IA.",
    icon: Tags,
  },
];

export default async function OrcamentoConfiguracoesPage() {
  const { user, profile } = await getCurrentSessionContext();
  if (!user) redirect("/login");
  // Módulo Orçamento é exclusivo de admin.
  if (!profile || profile.profile !== "admin") redirect("/dashboard");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground">
          Cadastros e ajustes administrativos do módulo Orçamento.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {CARDS.map((card) => {
          const Icon = card.icon;

          const inner = (
            <>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground group-hover:text-foreground">
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 font-semibold">
                  {card.title}
                  {card.href ? (
                    <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  ) : (
                    <span className="ml-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Em breve
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{card.description}</p>
              </div>
            </>
          );

          if (card.href) {
            return (
              <Link
                key={card.title}
                href={card.href}
                className="group flex items-start gap-4 rounded-lg border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-muted/40"
              >
                {inner}
              </Link>
            );
          }

          return (
            <div
              key={card.title}
              aria-disabled
              className="group flex items-start gap-4 rounded-lg border border-dashed bg-card/50 p-5 opacity-70"
            >
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}
