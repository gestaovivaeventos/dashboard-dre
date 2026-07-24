import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ConnectionsGrid } from "@/components/app/connections-grid";
import { SegmentSelector } from "@/components/app/segment-selector";
import { getCurrentSessionContext } from "@/lib/auth/session";
import type { Segment } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ segmentSlug: string }>;
}

// Painel Administrador → Conexões. Status de sincronização, planilhas conectadas
// e histórico (por segmento).
export default async function PainelConexoesPage({ params }: PageProps) {
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
      <Link
        href={`/s/${segmentSlug}/painel-administrador`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Painel Administrador
      </Link>

      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Conexões</h1>
        <p className="text-sm text-muted-foreground">
          Status de sincronização, planilhas conectadas e histórico — por segmento.
        </p>
      </div>

      {segments.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-ink-secondary">Segmento:</span>
          <SegmentSelector segments={segments} activeSlug={segmentSlug} />
        </div>
      ) : null}

      <ConnectionsGrid segmentSlug={segmentSlug} hideManualSync />
    </div>
  );
}
