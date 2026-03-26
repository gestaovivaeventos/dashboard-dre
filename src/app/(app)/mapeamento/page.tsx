import { redirect } from "next/navigation";

import { MappingManager } from "@/components/app/mapping-manager";
import { getCurrentSessionContext } from "@/lib/auth/session";

export default async function MapeamentoPage() {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    redirect("/login");
  }
  if (!profile || profile.role !== "admin") {
    redirect("/dashboard");
  }

  const [{ data: companiesData }, { data: dreAccountsData }] = await Promise.all([
    supabase.from("companies").select("id,name,active").eq("active", true).order("name"),
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
