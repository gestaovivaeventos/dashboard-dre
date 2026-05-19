import { redirect } from "next/navigation";

import { MappingManager } from "@/components/app/mapping-manager";
import { getCurrentSessionContext } from "@/lib/auth/session";
import type { Segment } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

interface MapeamentoPageProps {
  params: Promise<{ segmentSlug: string }>;
}

export default async function MapeamentoPage({ params }: MapeamentoPageProps) {
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

  let companiesQuery = supabase.from("companies").select("id,name,active").eq("active", true);
  if (segmentId) {
    companiesQuery = companiesQuery.eq("segment_id", segmentId);
  }

  const { data: companiesData } = await companiesQuery.order("name");

  const companies = (companiesData ?? []).map((company) => ({
    id: company.id as string,
    name: company.name as string,
  }));

  const companyIds = companies.map((c) => c.id);

  // Carrega o plano global (company_id IS NULL) + os planos customizados
  // das empresas deste segmento. O componente filtra por empresa selecionada.
  const [{ data: globalDreData }, { data: segmentDreData }, { data: cashFlowAccountsData }] =
    await Promise.all([
      supabase
        .from("dre_accounts")
        .select("id,code,name,active,company_id")
        .eq("active", true)
        .is("company_id", null)
        .order("code"),
      companyIds.length > 0
        ? supabase
            .from("dre_accounts")
            .select("id,code,name,active,company_id")
            .eq("active", true)
            .in("company_id", companyIds)
            .order("code")
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      supabase
        .from("cash_flow_accounts")
        .select("id,code,name,active,source")
        .eq("active", true)
        .order("sort_order"),
    ]);

  const dreAccounts = [...(globalDreData ?? []), ...(segmentDreData ?? [])]
    .map((account) => ({
      id: account.id as string,
      code: account.code as string,
      name: account.name as string,
      company_id: (account.company_id as string | null) ?? null,
    }))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  // Apenas analiticas (sem source) podem ser mapeadas.
  const cashFlowAccounts = (cashFlowAccountsData ?? [])
    .filter((a) => !(a.source as string | null))
    .map((account) => ({
      id: account.id as string,
      code: account.code as string,
      name: account.name as string,
    }))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  return (
    <MappingManager
      companies={companies}
      dreAccounts={dreAccounts}
      cashFlowAccounts={cashFlowAccounts}
      segments={segments}
      currentSegmentSlug={segmentSlug}
    />
  );
}
