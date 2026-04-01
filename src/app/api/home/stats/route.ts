import { NextResponse } from "next/server";
import { getCurrentSessionContext } from "@/lib/auth/session";

export async function GET() {
  const { supabase, user } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }

  // Fetch all stats in parallel
  const [
    { count: companiesCount },
    { count: usersCount },
    { count: segmentsCount },
    { count: entriesCount },
    { data: syncErrors },
    { data: unmappedData },
    { data: companiesData },
    { data: latestSyncs },
  ] = await Promise.all([
    supabase.from("companies").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("users").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("segments").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("financial_entries").select("id", { count: "exact", head: true }),
    // Companies with sync errors (latest sync per company)
    supabase.from("sync_log").select("company_id,status,error_message").eq("status", "error").order("started_at", { ascending: false }).limit(20),
    // Unmapped categories count
    supabase.from("financial_entries").select("omie_category_code").is("dre_account_id", null).limit(500),
    // All active companies for "no data" check
    supabase.from("companies").select("id,name").eq("active", true),
    // Latest sync per company
    supabase.from("sync_log").select("company_id,started_at,status").order("started_at", { ascending: false }),
  ]);

  // Build stats
  const stats = {
    activeCompanies: companiesCount ?? 0,
    activeUsers: usersCount ?? 0,
    segments: segmentsCount ?? 0,
    totalEntries: entriesCount ?? 0,
  };

  // Build alerts
  const alerts: Array<{ type: "error" | "warning"; title: string; detail: string }> = [];

  // Alert: sync errors - get unique companies with errors
  const errorCompanyIds = new Set<string>();
  (syncErrors ?? []).forEach((log) => {
    errorCompanyIds.add(log.company_id as string);
  });
  if (errorCompanyIds.size > 0) {
    alerts.push({
      type: "error",
      title: `${errorCompanyIds.size} empresa(s) com erro de sync`,
      detail: "Verifique o Painel Administrador",
    });
  }

  // Alert: unmapped categories
  const unmappedCount = (unmappedData ?? []).length;
  if (unmappedCount > 0) {
    alerts.push({
      type: "warning",
      title: `${unmappedCount} lancamento(s) sem mapeamento DRE`,
      detail: "Categorias Omie precisam ser mapeadas",
    });
  }

  // Alert: companies with no recent sync (no sync in last 48h)
  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const companiesWithRecentSync = new Set<string>();
  (latestSyncs ?? []).forEach((log) => {
    if (new Date(log.started_at as string) > twoDaysAgo) {
      companiesWithRecentSync.add(log.company_id as string);
    }
  });
  const companiesWithoutSync = (companiesData ?? []).filter(
    (c) => !companiesWithRecentSync.has(c.id as string)
  );
  if (companiesWithoutSync.length > 0) {
    alerts.push({
      type: "warning",
      title: `${companiesWithoutSync.length} empresa(s) sem sync recente`,
      detail: "Sem sincronizacao nas ultimas 48h",
    });
  }

  // If no alerts, add a positive one
  if (alerts.length === 0) {
    alerts.push({
      type: "warning",
      title: "Tudo certo!",
      detail: "Nenhum alerta no momento",
    });
  }

  return NextResponse.json({ stats, alerts });
}
