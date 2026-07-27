import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { KpiAdminManager } from "@/components/app/kpi-admin-manager";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { loadSettingsData } from "@/lib/settings/load-settings-data";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ segmentSlug: string }>;
}

export default async function KpisPage({ params }: PageProps) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user) redirect("/login");
  if (!profile || profile.role !== "admin") redirect("/dashboard");

  const { segmentSlug } = await params;
  const { kpis, dreAccounts } = await loadSettingsData(segmentSlug);

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
        <h1 className="mt-2 text-2xl font-bold tracking-tight">KPIs</h1>
        <p className="text-muted-foreground">
          Definições de indicadores calculados a partir das contas do DRE.
        </p>
      </div>

      <KpiAdminManager
        initialKpis={kpis}
        dreAccounts={dreAccounts.map((account) => ({ code: account.code, name: account.name }))}
      />
    </div>
  );
}
