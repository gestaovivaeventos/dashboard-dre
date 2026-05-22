import { redirect } from "next/navigation";

import { OnePageReportPreview } from "@/components/financeiro/relatorios/OnePageReportPreview";
import { getCurrentSessionContext } from "@/lib/auth/session";

// ============================================================================
// /financeiro/business-intelligence
//
// Pagina de PREVIEW do One Page Report. Usa dados mockados embutidos no
// componente — NAO chama IA, NAO consulta banco, NAO toca a rota oficial.
// Objetivo: validar layout, hierarquia visual e experiencia de leitura.
// ============================================================================

export const dynamic = "force-dynamic";

export default async function BusinessIntelligencePage() {
  const { user } = await getCurrentSessionContext();
  if (!user) {
    redirect("/login");
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 p-4 sm:p-6">
      <OnePageReportPreview />
    </div>
  );
}
