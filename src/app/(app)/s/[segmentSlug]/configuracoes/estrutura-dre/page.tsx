import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { DreStructureManager } from "@/components/app/dre-structure-manager";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { loadSettingsData } from "@/lib/settings/load-settings-data";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ segmentSlug: string }>;
}

export default async function EstruturaDrePage({ params }: PageProps) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user) redirect("/login");
  if (!profile || profile.role !== "admin") redirect("/dashboard");

  const { segmentSlug } = await params;
  const { dreAccounts, companies, allCompanies } = await loadSettingsData(segmentSlug);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/s/${segmentSlug}/configuracoes`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Configurações
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Estrutura DRE</h1>
        <p className="text-muted-foreground">
          Plano de contas do DRE e mapeamento de categorias Omie.
        </p>
      </div>

      <DreStructureManager
        initialAccounts={dreAccounts}
        companies={companies.map((c) => ({ id: c.id, name: c.name }))}
        allCompanies={allCompanies ?? companies.map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
