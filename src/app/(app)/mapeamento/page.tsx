import { redirect } from "next/navigation";

import { MappingManager } from "@/components/app/mapping-manager";
import { getCurrentSessionContext } from "@/lib/auth/session";

interface MapeamentoPageProps {
  params?: { segmentSlug?: string };
}

export default async function MapeamentoPage({ params }: MapeamentoPageProps) {
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

  let companiesQuery = supabase.from("companies").select("id,name,active").eq("active", true);
  if (segmentId) {
    companiesQuery = companiesQuery.eq("segment_id", segmentId);
  }

  const [{ data: companiesData }, { data: dreAccountsData }] = await Promise.all([
    companiesQuery.order("name"),
    supabase
      .from("dre_accounts")
      .select("id,code,name,active")
      .eq("active", true)
      .order("code"),
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

  return <MappingManager companies={companies} dreAccounts={dreAccounts} />;
}
