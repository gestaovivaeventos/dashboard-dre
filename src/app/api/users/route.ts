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

  const [
    { data, error },
    { data: compAccessData },
    { data: sectorAccessData },
    { data: companiesData },
    { data: sectorsData },
  ] = await Promise.all([
    supabase
      .from("users")
      .select(
        "id,email,name,role,profile,can_financeiro,can_compras,company_id,active,contracts_only,created_at",
      )
      .order("created_at", { ascending: false }),
    adminClient.from("user_company_access").select("user_id,company_id"),
    adminClient.from("user_sectors").select("user_id,sector_id"),
    supabase.from("companies").select("id,name").eq("active", true),
    supabase.from("ctrl_sectors").select("id,name").eq("active", true),
  ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const companyNames = new Map((companiesData ?? []).map((c) => [c.id as string, c.name as string]));
  const sectorNames = new Map((sectorsData ?? []).map((s) => [s.id as string, s.name as string]));

  const userCompanies = new Map<string, Array<{ id: string; name: string }>>();
  (compAccessData ?? []).forEach((row) => {
    const uid = row.user_id as string;
    const cid = row.company_id as string;
    const name = companyNames.get(cid);
    if (!name) return;
    const list = userCompanies.get(uid) ?? [];
    list.push({ id: cid, name });
    userCompanies.set(uid, list);
  });

  const userSectors = new Map<string, Array<{ id: string; name: string }>>();
  (sectorAccessData ?? []).forEach((row) => {
    const uid = row.user_id as string;
    const sid = row.sector_id as string;
    const name = sectorNames.get(sid);
    if (!name) return;
    const list = userSectors.get(uid) ?? [];
    list.push({ id: sid, name });
    userSectors.set(uid, list);
  });

  const users = (data ?? []).map((item) => ({
    id: item.id as string,
    email: item.email as string,
    name: (item.name as string | null) ?? "",
    profile: (item.profile as string | null) ?? "solicitante",
    can_financeiro: Boolean(item.can_financeiro),
    can_compras: Boolean(item.can_compras),
    active: Boolean(item.active),
    created_at: item.created_at as string,
    // Legacy fields for backwards compatibility with the existing UI:
    role: item.role as "admin" | "gestor_hero" | "gestor_unidade",
    company_id: (item.company_id as string | null) ?? null,
    contracts_only: Boolean(item.contracts_only),
    companies: userCompanies.get(item.id as string) ?? [],
    sectors: userSectors.get(item.id as string) ?? [],
  }));

  return NextResponse.json({ users });
}
