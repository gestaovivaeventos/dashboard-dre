import { redirect } from "next/navigation";
import { Lock } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { getDpUser } from "@/lib/dp/auth";

export const dynamic = "force-dynamic";

/**
 * Visão geral do Departamento Pessoal. Por ora só marca a existência do
 * módulo; as áreas (cadastro de colaboradores, admissão, folha, férias…) entram
 * uma a uma.
 */
export default async function DpOverviewPage() {
  const user = await getDpUser();
  if (!user) redirect("/");

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink-primary">Departamento Pessoal</h1>
        <p className="text-sm text-ink-muted">
          Gestão de colaboradores, admissões, folha e obrigações trabalhistas do grupo.
        </p>
      </div>

      <Card>
        <CardContent className="flex items-start gap-3 py-6 text-sm text-ink-muted">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Módulo em construção e de acesso restrito: só quem recebeu a concessão enxerga esta
            área — administradores não têm acesso automático.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
