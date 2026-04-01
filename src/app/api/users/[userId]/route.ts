import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/lib/supabase/types";

interface Params {
  params: {
    userId: string;
  };
}

export async function PATCH(request: Request, { params }: Params) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const body = (await request.json()) as {
    name?: string;
    role?: UserRole;
    company_id?: string | null;
    active?: boolean;
  };

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") patch.name = body.name.trim();
  if (body.role) patch.role = body.role;
  if (body.company_id !== undefined) patch.company_id = body.company_id;
  if (body.active !== undefined) patch.active = body.active;

  // company_id is optional for gestor_unidade — access is now managed via
  // segment/company permission tables (user_segment_access, user_company_access)
  if (body.role && body.role !== "gestor_unidade") {
    patch.company_id = null;
  }

  console.log("[PATCH /api/users] userId:", params.userId, "body:", JSON.stringify(body), "patch:", JSON.stringify(patch));

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("users")
    .update(patch)
    .eq("id", params.userId)
    .select("id, role, name, company_id");

  console.log("[PATCH /api/users] result:", JSON.stringify({ data, error }));

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Usuario nao encontrado." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, updated: data[0] });
}

export async function DELETE(_: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const { error } = await supabase.from("users").update({ active: false }).eq("id", params.userId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  try {
    const adminClient = createAdminClient();
    await adminClient.auth.admin.updateUserById(params.userId, { ban_duration: "876000h" });
  } catch {
    // Soft delete at application-level is the primary safeguard.
  }

  return NextResponse.json({ ok: true });
}
