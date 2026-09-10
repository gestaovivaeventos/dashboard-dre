// src/app/(vb)/vb/omie/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { VbOmieTriage, type OmieTab } from "@/components/vb/omie-triage";
import { formatDayBR } from "@/lib/ctrl/datetime";
import { createAdminClient } from "@/lib/supabase/admin";
import { getVbUser } from "@/lib/vb/auth";
import { VB_OMIE_COMPANY_NAME, VB_OMIE_START_DATE } from "@/lib/vb/omie/config";
import { getOmieSyncStatus, listPendingMovements, listTriage, suggestionMemory } from "@/lib/vb/omie/queries";
import { listCreditors } from "@/lib/vb/queries";

export const dynamic = "force-dynamic";

const TABS: readonly OmieTab[] = ["pendentes", "vinculados", "descartados"];

export default async function VbOmiePage({ searchParams }: { searchParams: { aba?: string } }) {
  const user = await getVbUser();
  if (!user) redirect("/");
  if (user.role !== "gestor") redirect("/vb");
  const tab: OmieTab = TABS.includes(searchParams.aba as OmieTab) ? (searchParams.aba as OmieTab) : "pendentes";

  // Admin client de propósito (ver queries.ts): o gestor do VB não precisa ter vínculo com a ABD.
  const admin = createAdminClient();
  const [pending, linked, discarded, creditors, memory, sync] = await Promise.all([
    listPendingMovements(),
    listTriage("vinculado"),
    listTriage("descartado"),
    listCreditors(admin),
    suggestionMemory(),
    getOmieSyncStatus(),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link href="/vb" className="inline-flex items-center gap-1 text-xs text-ink-muted hover:underline">
          <ArrowLeft className="h-3 w-3" /> Visão geral
        </Link>
        <h1 className="text-xl font-semibold text-ink-primary">Omie · {VB_OMIE_COMPANY_NAME}</h1>
        <span className="text-[11px] text-ink-muted">
          Pagamentos desde {formatDayBR(VB_OMIE_START_DATE)}. Descarte o que não é do VB; vincule o que é.
        </span>
      </div>
      <VbOmieTriage
        tab={tab}
        pending={pending}
        linked={linked}
        discarded={discarded}
        creditors={creditors.map(({ id, name, active }) => ({ id, name, active }))}
        memory={memory}
        sync={sync}
      />
    </div>
  );
}
