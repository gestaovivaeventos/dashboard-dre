import { redirect } from "next/navigation";

import { ConnectionsGrid } from "@/components/app/connections-grid";
import { SegmentSelector } from "@/components/app/segment-selector";
import { SettingsCompanies } from "@/components/app/settings-companies";
import { getCurrentSessionContext } from "@/lib/auth/session";
import type { Segment } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

interface PainelAdministradorPageProps {
  params: Promise<{ segmentSlug: string }>;
}

/**
 * Painel Administrador (nova tela).
 *
 * Reune, em um unico lugar e por segmento, as acoes administrativas que antes
 * viviam espalhadas em "Configuracoes > Empresas" e em "Conexoes":
 *   • Gestao de empresas, credenciais Omie, teste de conexao, sincronizacao com
 *     selecao de periodo e orcamento  → <SettingsCompanies /> (inalterado)
 *   • Status de sincronizacao, planilhas conectadas e historico → <ConnectionsGrid />
 *
 * Importante: NENHUMA regra de negocio muda aqui. Esta tela apenas reaproveita
 * os componentes existentes em um novo local. As acoes "Sincronizar Agora" e
 * "Sincronizar Tudo" (sem selecao de periodo) ficam ocultas via `hideManualSync`
 * — a sincronizacao com selecao de periodo continua disponivel dentro de
 * <SettingsCompanies />, exatamente como hoje.
 *
 * As telas antigas (Configuracoes > Empresas e Conexoes) permanecem ativas
 * durante a transicao.
 */
export default async function PainelAdministradorPage({
  params,
}: PainelAdministradorPageProps) {
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
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Painel Administrador</h1>
        <p className="text-sm text-muted-foreground">
          Gestao de empresas, integracao Omie, orcamento, status de sincronizacao,
          planilhas conectadas e historico — tudo em um so lugar, por segmento.
        </p>
      </div>

      {segments.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-ink-secondary">Segmento:</span>
          <SegmentSelector segments={segments} activeSlug={segmentSlug} />
        </div>
      ) : null}

      {/* Gestao de empresas + Integracao Omie + Orcamento (itens 1-7). */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Gestao de empresas e Integracao Omie</h2>
        <SettingsCompanies
          initialCompanies={companies}
          segmentId={segmentId}
          currentSegmentSlug={segmentSlug}
        />
      </section>

      {/* Status de sincronizacao + Planilhas conectadas + Historico (itens 8, 9, 12). */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Status, planilhas conectadas e historico</h2>
        <ConnectionsGrid segmentSlug={segmentSlug} hideManualSync />
      </section>
    </div>
  );
}
