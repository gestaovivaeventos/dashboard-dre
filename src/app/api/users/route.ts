import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const adminClient = createAdminClient();

  const [{ data, error }, { data: segAccessData }, { data: compAccessData }, { data: segmentsData }, { data: companiesData }] =
    await Promise.all([
      supabase
        .from("users")
        .select("id,email,name,role,company_id,active,created_at,companies(name)")
        .order("created_at", { ascending: false }),
      adminClient.from("user_segment_access").select("user_id,segment_id"),
      adminClient.from("user_company_access").select("user_id,company_id"),
      supabase.from("segments").select("id,name").eq("active", true),
      supabase.from("companies").select("id,name").eq("active", true),
    ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const segmentNames = new Map((segmentsData ?? []).map((s) => [s.id as string, s.name as string]));
  const companyNames = new Map((companiesData ?? []).map((c) => [c.id as string, c.name as string]));

  // Build lookup maps: userId -> segment names, userId -> company names
  const userSegments = new Map<string, string[]>();
  (segAccessData ?? []).forEach((row) => {
    const uid = row.user_id as string;
    const name = segmentNames.get(row.segment_id as string);
    if (name) {
      const list = userSegments.get(uid) ?? [];
      list.push(name);
      userSegments.set(uid, list);
    }
  });

  const userCompanies = new Map<string, string[]>();
  (compAccessData ?? []).forEach((row) => {
    const uid = row.user_id as string;
    const name = companyNames.get(row.company_id as string);
    if (name) {
      const list = userCompanies.get(uid) ?? [];
      list.push(name);
      userCompanies.set(uid, list);
    }
  });

  const users = (data ?? []).map((item) => ({
    id: item.id as string,
    email: item.email as string,
    name: (item.name as string | null) ?? "",
    role: item.role as "admin" | "gestor_hero" | "gestor_unidade",
    company_id: (item.company_id as string | null) ?? null,
    company_name: ((item.companies as { name?: string } | null)?.name ?? null) as string | null,
    active: Boolean(item.active),
    created_at: item.created_at as string,
    segment_names: userSegments.get(item.id as string) ?? [],
    company_names: userCompanies.get(item.id as string) ?? [],
  }));

  return NextResponse.json({ users });
}
