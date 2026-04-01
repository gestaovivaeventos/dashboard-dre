import { redirect } from "next/navigation";

import { AdminPanelView } from "@/components/app/admin-panel-view";
import { getCurrentSessionContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    redirect("/login");
  }
  if (!profile || profile.role !== "admin") {
    redirect("/dashboard");
  }

  const [{ data: companiesData }, { data: segmentsData }, { data: syncData }] =
    await Promise.all([
      supabase
        .from("companies")
        .select("id,name,active,segment_id,created_at")
        .order("name"),
      supabase
        .from("segments")
        .select("id,name,slug,display_order")
        .eq("active", true)
        .order("display_order"),
      supabase
        .from("sync_log")
        .select("company_id,started_at,finished_at,status,records_imported,error_message")
        .order("started_at", { ascending: false }),
    ]);

  const segments = (segmentsData ?? []).map((s) => ({
    id: s.id as string,
    name: s.name as string,
    slug: s.slug as string,
  }));

  const segmentMap = new Map(segments.map((s) => [s.id, s.name]));

  // Get latest sync per company
  const latestSyncByCompany = new Map<
    string,
    { status: string; finished_at: string | null; started_at: string; records_imported: number; error_message: string | null }
  >();
  (syncData ?? []).forEach((log) => {
    const companyId = log.company_id as string;
    if (!latestSyncByCompany.has(companyId)) {
      latestSyncByCompany.set(companyId, {
        status: log.status as string,
        finished_at: (log.finished_at as string | null) ?? null,
        started_at: log.started_at as string,
        records_imported: Number(log.records_imported ?? 0),
        error_message: (log.error_message as string | null) ?? null,
      });
    }
  });

  const companies = (companiesData ?? []).map((c) => {
    const lastSync = latestSyncByCompany.get(c.id as string);
    return {
      id: c.id as string,
      name: c.name as string,
      active: c.active as boolean,
      segment_name: c.segment_id ? segmentMap.get(c.segment_id as string) ?? "—" : "Sem segmento",
      segment_id: (c.segment_id as string | null) ?? null,
      last_sync_at: lastSync?.finished_at ?? lastSync?.started_at ?? null,
      last_sync_status: lastSync?.status ?? null,
      last_sync_records: lastSync?.records_imported ?? 0,
      last_sync_error: lastSync?.error_message ?? null,
    };
  });

  return <AdminPanelView companies={companies} segments={segments} />;
}
