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
      .select("id,name,segment_id")
      .eq("active", true)
      .order("name"),
    supabase
      .from("segments")
      .select("id,name,slug")
      .eq("active", true)
      .order("display_order"),
  ]);

  const segments = (segmentsData ?? []).map((s) => ({
    id: s.id as string,
    name: s.name as string,
    slug: s.slug as string,
  }));

  const segmentById = new Map(segments.map((s) => [s.id, s]));

  const companies = (companiesData ?? []).map((c) => {
    const seg = segmentById.get(c.segment_id as string);
    return {
      id: c.id as string,
      name: c.name as string,
      segmentSlug: seg?.slug ?? null,
    };
  });

  return <IntelligenceView companies={companies} segments={segments} />;
}
