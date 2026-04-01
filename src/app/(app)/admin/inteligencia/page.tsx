import { redirect } from "next/navigation";

import { IntelligenceView } from "@/components/app/intelligence-view";
import { getCurrentSessionContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function IntelligenciaPage() {
  const { supabase, user, profile } = await getCurrentSessionContext();

  if (!user) {
    redirect("/login");
  }
  if (!profile || profile.role !== "admin") {
    redirect("/dashboard");
  }

  const [{ data: companiesData }, { data: segmentsData }] = await Promise.all([
    supabase
      .from("companies")
      .select("id,name")
      .eq("active", true)
      .order("name"),
    supabase
      .from("segments")
      .select("id,name")
      .eq("active", true)
      .order("display_order"),
  ]);

  const companies = (companiesData ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
  }));

  const segments = (segmentsData ?? []).map((s) => ({
    id: s.id as string,
    name: s.name as string,
  }));

  return <IntelligenceView companies={companies} segments={segments} />;
}
