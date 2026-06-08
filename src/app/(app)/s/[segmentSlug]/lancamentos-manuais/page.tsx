import { redirect } from "next/navigation";

import { ManualEntriesManager } from "@/components/app/manual-entries-manager";
import { getCurrentSessionContext } from "@/lib/auth/session";
import type { Segment } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

interface LancamentosManuaisPageProps {
  params: Promise<{ segmentSlug: string }>;
}

export default async function LancamentosManuaisPage({
  params,
}: LancamentosManuaisPageProps) {
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
    .select("id,name,active")
    .eq("active", true);
  if (segmentId) {
    companiesQuery = companiesQuery.eq("segment_id", segmentId);
  }

  const { data: companiesData } = await companiesQuery.order("name");

  const companies = (companiesData ?? []).map((company) => ({
    id: company.id as string,
    name: company.name as string,
  }));

  return (
    <ManualEntriesManager
      companies={companies}
      segments={segments}
      currentSegmentSlug={segmentSlug}
    />
  );
}
