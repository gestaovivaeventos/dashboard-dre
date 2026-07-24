import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AiAdminClient } from "@/components/app/ai-admin-client";
import { getAiPanelData } from "@/lib/ai/settings-actions";
import { getCurrentSessionContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ segmentSlug: string }>;
}

// Painel Administrador → Inteligência Artificial. Configuração global (não
// depende de segmento): provedor ativo, provedores, câmbio e consumo/custo.
export default async function PainelIaPage({ params }: PageProps) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user) {
    redirect("/login");
  }
  if (!profile || profile.role !== "admin") {
    redirect("/dashboard");
  }

  const { segmentSlug } = await params;

  let data: Awaited<ReturnType<typeof getAiPanelData>> | null = null;
  try {
    data = await getAiPanelData();
  } catch {
    data = null;
  }

  return (
    <div className="space-y-6">
      <Link
        href={`/s/${segmentSlug}/painel-administrador`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Painel Administrador
      </Link>

      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Inteligência Artificial</h1>
        <p className="text-sm text-muted-foreground">
          Provedor de IA usado pelo BI e demais funcionalidades, provedores adicionais e consumo/custo em reais.
        </p>
      </div>

      {data ? (
        <AiAdminClient initial={data} embedded />
      ) : (
        <p className="text-sm text-muted-foreground">
          Não foi possível carregar as configurações de IA. Verifique se as migrações
          20260724120000 e 20260724130000 foram aplicadas no banco.
        </p>
      )}
    </div>
  );
}
