import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Cog, Plug, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { getCurrentSessionContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

interface PainelAdministradorPageProps {
  params: Promise<{ segmentSlug: string }>;
}

interface HubCard {
  title: string;
  description: string;
  sub: string;
  icon: LucideIcon;
}

// Submenu do Painel Administrador — cada card leva a uma área. Configurações e
// Conexões são por segmento (o seletor de segmento vive dentro delas);
// Inteligência Artificial é global.
const CARDS: HubCard[] = [
  {
    title: "Configurações",
    description: "Gestão de empresas, integração Omie e orçamento — por segmento.",
    sub: "configuracoes",
    icon: Cog,
  },
  {
    title: "Conexões",
    description: "Status de sincronização, planilhas conectadas e histórico — por segmento.",
    sub: "conexoes",
    icon: Plug,
  },
  {
    title: "Inteligência Artificial",
    description: "Provedor de IA (OpenAI/DeepSeek), provedores adicionais e consumo/custo em reais.",
    sub: "inteligencia-artificial",
    icon: Sparkles,
  },
];

export default async function PainelAdministradorPage({ params }: PainelAdministradorPageProps) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user) {
    redirect("/login");
  }
  if (!profile || profile.role !== "admin") {
    redirect("/dashboard");
  }

  const { segmentSlug } = await params;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Painel Administrador</h1>
        <p className="text-sm text-muted-foreground">Escolha uma área para administrar.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.sub}
              href={`/s/${segmentSlug}/painel-administrador/${card.sub}`}
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
