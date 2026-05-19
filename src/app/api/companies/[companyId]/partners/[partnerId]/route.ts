import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

interface Params {
  params: {
    companyId: string;
    partnerId: string;
  };
}

/**
 * PUT — Atualiza nome do socio.
 * Body: { name: string }
 */
export async function PUT(request: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (!profile || profile.role !== "admin") {
    return NextResponse.json(
      { error: "Apenas admin pode editar socios." },
      { status: 403 },
    );
  }

  const body = (await request.json()) as { name?: string };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Nome do socio e obrigatorio." }, { status: 400 });
  }

  const db = createAdminClientIfAvailable() ?? supabase;

  const { error } = await db
    .from("company_partners")
    .update({ name, updated_at: new Date().toISOString(), updated_by: profile.id })
    .eq("id", params.partnerId)
    .eq("company_id", params.companyId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE — Remove o socio (e seus vinculos via ON DELETE CASCADE).
 */
export async function DELETE(_request: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (!profile || profile.role !== "admin") {
    return NextResponse.json(
      { error: "Apenas admin pode remover socios." },
      { status: 403 },
    );
  }

  const db = createAdminClientIfAvailable() ?? supabase;

  const { error } = await db
    .from("company_partners")
    .delete()
    .eq("id", params.partnerId)
    .eq("company_id", params.companyId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
