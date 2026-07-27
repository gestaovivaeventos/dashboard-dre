import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { SegmentSelector } from "@/components/app/segment-selector";
import { SettingsCompanies } from "@/components/app/settings-companies";
import { getCurrentSessionContext } from "@/lib/auth/session";
import type { Segment } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ segmentSlug: string }>;
}

// Painel Administrador → Configurações. Gestão de empresas, credenciais Omie,
// teste de conexão, sincronização com período e orçamento (por segmento).
export default async function PainelConfiguracoesPage({ params }: PageProps) {
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
  const currentSegment = segments.find((s) => s.slug === segmentSlug) ?? null;
  const segmentId = currentSegment?.id ?? null;

  let companiesQuery = supabase
    .from("companies")
    .select("id,name,active,created_at,omie_app_key,omie_app_secret");
  if (segmentId) {
    companiesQuery = companiesQuery.eq("segment_id", segmentId);
  }
  const { data: companiesData } = await companiesQuery.order("name");

  const companies = (companiesData ?? []).map((company) => ({
    id: company.id as string,
    name: company.name as string,
    active: company.active as boolean,
    created_at: company.created_at as string,
    has_credentials: Boolean(company.omie_app_key && company.omie_app_secret),
  }));

  return (
    <div className="space-y-6">
      <Link
        href={`/s/${segmentSlug}/painel-administrador`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Painel Administrador
      </Link>

      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          Gestão de empresas, integração Omie e orçamento — por segmento.
        </p>
      </div>

      {segments.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-ink-secondary">Segmento:</span>
          <SegmentSelector segments={segments} activeSlug={segmentSlug} />
        </div>
      ) : null}

      <SettingsCompanies
        initialCompanies={companies}
        segmentId={segmentId}
        currentSegmentSlug={segmentSlug}
      />
    </div>
  );
}
