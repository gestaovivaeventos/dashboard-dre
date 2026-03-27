import { redirect } from "next/navigation";

import { SettingsTabs } from "@/components/app/settings-tabs";
import { getCurrentSessionContext } from "@/lib/auth/session";
import type { KpiDefinition } from "@/lib/kpi/calc";

interface ConfiguracoesPageProps {
  params?: { segmentSlug?: string };
}

export default async function ConfiguracoesPage({ params }: ConfiguracoesPageProps) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    redirect("/login");
  }
  if (!profile || profile.role !== "admin") {
    redirect("/dashboard");
  }

  let segmentId: string | null = null;
  if (params?.segmentSlug) {
    const { data: seg } = await supabase
      .from("segments")
      .select("id")
      .eq("slug", params.segmentSlug)
      .eq("active", true)
      .maybeSingle<{ id: string }>();
    segmentId = seg?.id ?? null;
  }

  let companiesQuery = supabase
    .from("companies")
    .select("id,name,active,created_at,omie_app_key,omie_app_secret");
  if (segmentId) {
    companiesQuery = companiesQuery.eq("segment_id", segmentId);
  }

  const [companiesResult, dreResult, mappingsResult, kpisResult] = await Promise.all([
    companiesQuery.order("name"),
    supabase
      .from("dre_accounts")
      .select("id,code,name,parent_id,level,type,is_summary,formula,sort_order,active")
      .order("code"),
    supabase
      .from("category_mapping")
      .select("id,omie_category_code,omie_category_name,dre_account_id,company_id")
      .order("omie_category_code"),
    supabase
      .from("kpi_definitions")
      .select(
        "id,name,description,formula_type,numerator_account_codes,denominator_account_codes,multiply_by,sort_order,active",
      )
      .order("sort_order", { ascending: true }),
  ]);

  const companies = (companiesResult.data ?? []).map((company) => ({
    id: company.id as string,
    name: company.name as string,
    active: company.active as boolean,
    created_at: company.created_at as string,
    has_credentials: Boolean(company.omie_app_key && company.omie_app_secret),
  }));

  const mappingByAccount = new Map<
    string,
    Array<{ id: string; code: string; name: string; company_id: string | null }>
  >();
  (mappingsResult.data ?? []).forEach((mapping) => {
    const accountId = mapping.dre_account_id as string;
    const entries = mappingByAccount.get(accountId) ?? [];
    entries.push({
      id: mapping.id as string,
      code: mapping.omie_category_code as string,
      name: mapping.omie_category_name as string,
      company_id: (mapping.company_id as string | null) ?? null,
    });
    mappingByAccount.set(accountId, entries);
  });

  const dreAccounts = (dreResult.data ?? []).map((account) => ({
    id: account.id as string,
    code: account.code as string,
    name: account.name as string,
    parent_id: (account.parent_id as string | null) ?? null,
    level: account.level as number,
    type: account.type as "receita" | "despesa" | "calculado" | "misto",
    is_summary: account.is_summary as boolean,
    formula: (account.formula as string | null) ?? null,
    sort_order: account.sort_order as number,
    active: account.active as boolean,
    mappings: mappingByAccount.get(account.id as string) ?? [],
  }));

  return (
    <SettingsTabs
      companies={companies}
      dreAccounts={dreAccounts}
      kpis={(kpisResult.data ?? []) as KpiDefinition[]}
    />
  );
}
