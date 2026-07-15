import { redirect } from "next/navigation";
import Link from "next/link";
import { Building2, Calendar, ChevronRight, GitMerge, Table2, Tags } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { getCtrlUser, hasCtrlRole } from "@/lib/ctrl/auth";

interface ConfigCard {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
}

// Telas de configuração do módulo Compras, agrupadas neste hub (admin-only).
const CARDS: ConfigCard[] = [
  {
    title: "Editar Orçamento",
    description: "Ajuste manual do previsto × realizado por setor e tipo de despesa.",
    href: "/ctrl/orcamento/editar",
    icon: Table2,
  },
  {
    title: "Eventos",
    description: "Cadastro de eventos vinculados às requisições de pagamento.",
    href: "/ctrl/admin/eventos",
    icon: Calendar,
  },
  {
    title: "Mapeamento Omie",
    description: "Vincula categoria, departamento e conta corrente por empresa pagadora.",
    href: "/ctrl/admin/omie-mapeamento",
    icon: GitMerge,
  },
  {
    title: "Setores",
    description: "Gerencie os setores — renomear, inativar e mesclar.",
    href: "/ctrl/admin/setores",
    icon: Building2,
  },
  {
    title: "Tipos de Despesa",
    description: "Gerencie os tipos de despesa — renomear, inativar e mesclar.",
    href: "/ctrl/admin/tipos-de-despesa",
    icon: Tags,
  },
];

export default async function ConfiguracoesPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");
  // Hub e todas as suas telas são exclusivas de admin.
  if (!hasCtrlRole(ctx, "admin")) redirect("/ctrl/requisicoes");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground">
          Cadastros e ajustes administrativos do módulo Compras.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.href}
              href={card.href}
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
