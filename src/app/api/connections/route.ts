import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";

export async function GET(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin" && profile.role !== "gestor_hero") {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }
  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status");
  const segmentSlug = url.searchParams.get("segment");

  let companyQuery = supabase
    .from("companies")
    .select("id,name,active,segment_id,last_full_sync_at")
    .eq("active", true);

  if (segmentSlug) {
    const { data: seg } = await supabase
      .from("segments")
      .select("id")
      .eq("slug", segmentSlug)
      .eq("active", true)
      .maybeSingle<{ id: string }>();
    if (seg) {
      companyQuery = companyQuery.eq("segment_id", seg.id);
    }
  }

  companyQuery = companyQuery.order("name");

  const { data: companies, error: companiesError } = await companyQuery;
  if (companiesError) {
    return NextResponse.json({ error: companiesError.message }, { status: 400 });
  }

  const summaries = await Promise.all(
    (companies ?? []).map(async (company) => {
      const syncLogQuery = supabase
        .from("sync_log")
        .select("started_at,finished_at,status,records_imported,error_message")
        .eq("company_id", company.id)
        .order("started_at", { ascending: false })
        .limit(30);
      if (statusFilter === "success" || statusFilter === "error") {
        syncLogQuery.eq("status", statusFilter);
      }

      const [{ data: sync }, { data: history }, { count: entriesCount }] = await Promise.all([
        supabase
          .from("sync_log")
          .select("started_at,finished_at,status,records_imported,error_message")
          .eq("company_id", company.id)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle<{
            started_at: string;
            finished_at: string | null;
            status: "success" | "error" | "running";
            records_imported: number | null;
            error_message: string | null;
          }>(),
        syncLogQuery,
        supabase
          .from("financial_entries")
          .select("*", { count: "exact", head: true })
          .eq("company_id", company.id),
      ]);

      return {
        id: company.id as string,
        name: company.name as string,
        last_full_sync_at: (company.last_full_sync_at as string | null) ?? null,
        last_sync_at: sync?.finished_at ?? sync?.started_at ?? null,
        last_sync_status: sync?.status ?? null,
        last_sync_error: sync?.error_message ?? null,
        entries_count: entriesCount ?? 0,
        sync_history: (history ?? []).map((item) => {
          const startedAt = item.started_at as string;
          const finishedAt = (item.finished_at as string | null) ?? null;
          const durationSeconds =
            finishedAt
              ? Math.max(
                  0,
                  Math.floor(
                    (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000,
                  ),
                )
              : null;
          return {
            started_at: startedAt,
            finished_at: finishedAt,
            status: item.status as "success" | "error" | "running",
            records_imported: Number(item.records_imported ?? 0),
            error_message: (item.error_message as string | null) ?? null,
            duration_seconds: durationSeconds,
          };
        }),
      };
    }),
  );

  return NextResponse.json({ companies: summaries });
}
