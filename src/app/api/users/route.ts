import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";

export async function GET() {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("users")
    .select("id,email,name,role,company_id,active,created_at,companies(name)")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const users = (data ?? []).map((item) => ({
    id: item.id as string,
    email: item.email as string,
    name: (item.name as string | null) ?? "",
    role: item.role as "admin" | "gestor_hero" | "gestor_unidade",
    company_id: (item.company_id as string | null) ?? null,
    company_name: ((item.companies as { name?: string } | null)?.name ?? null) as string | null,
    active: Boolean(item.active),
    created_at: item.created_at as string,
  }));

  return NextResponse.json({ users });
}
