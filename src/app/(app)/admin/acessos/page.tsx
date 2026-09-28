import { redirect } from "next/navigation";

import { AccessLogClient } from "@/components/admin/AccessLogClient";
import {
  ACCESS_LOG_PAGE_SIZE,
  accessLogQuery,
  fetchAccessLogSummary,
  parseAccessLogFilters,
  parseAccessLogPage,
} from "@/lib/auth/access-log";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AuthAccessLogRow } from "@/lib/supabase/types";

// ============================================================================
// /admin/acessos
//
// Log de acesso para compliance: cada sessão aberta (Entrada) e encerrada
// (Sessão encerrada), gravado por gatilho no banco — o login acontece no
// navegador e o app não participa. Filtros e paginação no servidor.
// ============================================================================

export const dynamic = "force-dynamic";

export default async function AcessosPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user) redirect("/login");
  if (!profile || profile.profile !== "admin") redirect("/dashboard");

  const filters = parseAccessLogFilters(searchParams);
  const page = parseAccessLogPage(searchParams);
  const offset = (page - 1) * ACCESS_LOG_PAGE_SIZE;

  const adminClient = createAdminClient();

  const [{ data: usersData }, rowsResult] = await Promise.all([
    adminClient.from("users").select("id,name,email").order("name", { nullsFirst: false }),
    accessLogQuery(adminClient, filters, true).range(offset, offset + ACCESS_LOG_PAGE_SIZE - 1),
  ]);
  if (rowsResult.error) {
    // Caso esperado entre o deploy e a aplicação da migration 20260930120000.
    console.error("[admin/acessos] auth_access_log read failed:", rowsResult.error.message);
    return (
      <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 text-sm text-muted-foreground">
        O registro de acessos ainda não está ativo no banco de dados.
      </div>
    );
  }

  const summary = await fetchAccessLogSummary(adminClient, filters);

  const users = (usersData ?? []).map((u) => ({
    id: u.id as string,
    name: (u.name as string | null) ?? null,
    email: u.email as string,
  }));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6">
      <AccessLogClient
        filters={filters}
        page={page}
        totalRows={rowsResult.count ?? 0}
        rows={(rowsResult.data ?? []) as AuthAccessLogRow[]}
        summary={summary}
        users={users}
      />
    </div>
  );
}
