import { redirect } from "next/navigation";

import { MappingManager } from "@/components/app/mapping-manager";
import { getCurrentSessionContext } from "@/lib/auth/session";

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

  const { data: seg } = await supabase
    .from("segments")
    .select("id")
    .eq("slug", segmentSlug)
    .eq("active", true)
    .maybeSingle<{ id: string }>();
  const segmentId = seg?.id ?? null;

  let companiesQuery = supabase.from("companies").select("id,name,active").eq("active", true);
  if (segmentId) {
    companiesQuery = companiesQuery.eq("segment_id", segmentId);
  }

  const [
    { data: companiesData },
    { data: dreAccountsData },
    { data: cashFlowAccountsData },
  ] = await Promise.all([
    companiesQuery.order("name"),
    supabase
      .from("dre_accounts")
      .select("id,code,name,active")
      .eq("active", true)
      .order("code"),
    supabase
      .from("cash_flow_accounts")
      .select("id,code,name,active,source")
      .eq("active", true)
      .order("sort_order"),
  ]);

  const companies = (companiesData ?? []).map((company) => ({
    id: company.id as string,
    name: company.name as string,
  }));

  const dreAccounts = (dreAccountsData ?? [])
    .map((account) => ({
      id: account.id as string,
      code: account.code as string,
      name: account.name as string,
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
    />
  );
}
