import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { encryptSecret } from "@/lib/security/encryption";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

interface Params {
  params: {
    companyId: string;
  };
}

export async function PATCH(request: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (!profile || profile.role !== "admin") {
    return NextResponse.json({ error: "Apenas admin pode editar empresas." }, { status: 403 });
  }

  const body = (await request.json()) as {
    name?: string;
    appKey?: string;
    appSecret?: string;
  };

  const db = createAdminClientIfAvailable() ?? supabase;
  const updates: Record<string, unknown> = {};

  // Rename
  const name = body.name?.trim();
  if (name) {
    updates.name = name;
  }

  // Credentials
  const appKey = body.appKey?.trim();
  const appSecret = body.appSecret?.trim();
  if (appKey && appSecret) {
    updates.omie_app_key = encryptSecret(appKey);
    updates.omie_app_secret = encryptSecret(appSecret);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "Nenhum campo para atualizar." },
      { status: 400 },
    );
  }

  const { error } = await db
    .from("companies")
    .update(updates)
    .eq("id", params.companyId);

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Ja existe uma empresa com esse nome." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (!profile || profile.role !== "admin") {
    return NextResponse.json({ error: "Apenas admin pode excluir empresas." }, { status: 403 });
  }

  const db = createAdminClientIfAvailable() ?? supabase;

  // Delete related data first
  await db.from("financial_entries").delete().eq("company_id", params.companyId);
  await db.from("category_mapping").delete().eq("company_id", params.companyId);
  await db.from("omie_categories").delete().eq("company_id", params.companyId);
  await db.from("sync_logs").delete().eq("company_id", params.companyId);

  const { error } = await db
    .from("companies")
    .delete()
    .eq("id", params.companyId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
