import { NextResponse } from "next/server";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

const PAGE_SIZE = 20;

export async function GET(request: Request) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const typeFilter = searchParams.get("type");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const offset = (page - 1) * PAGE_SIZE;

  const adminClient = createAdminClient();

  let query = adminClient
    .from("ai_reports")
    .select(
      "id, type, company_ids, period_from, period_to, recipients, sent_at, status, error_message, content_html, created_at",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (typeFilter) {
    query = query.eq("type", typeFilter);
  }

  const { data, error, count } = await query;

  if (error) {
    console.error("[intelligence/history] Query error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE);

  return NextResponse.json({ reports: data ?? [], page, totalPages });
}
