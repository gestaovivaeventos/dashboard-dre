import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/lib/supabase/types";

export async function POST(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const body = (await request.json()) as {
    email?: string;
    name?: string;
    role?: UserRole;
    company_id?: string | null;
  };

  const email = body.email?.trim().toLowerCase();
  const name = body.name?.trim();
  const role = body.role;
  const companyId = body.company_id ?? null;

  if (!email || !name || !role) {
    return NextResponse.json({ error: "Informe e-mail, nome e perfil." }, { status: 400 });
  }
  if (role === "gestor_unidade" && !companyId) {
    return NextResponse.json(
      { error: "Gestor_unidade exige unidade vinculada." },
      { status: 400 },
    );
  }

  const adminClient = createAdminClient();
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
    email,
    {
      redirectTo: `${appUrl}/auth/callback?next=/dashboard`,
      data: { name },
    },
  );

  if (inviteError || !inviteData.user) {
    return NextResponse.json(
      { error: inviteError?.message ?? "Falha ao enviar convite." },
      { status: 400 },
    );
  }

  const { error: upsertError } = await supabase.from("users").upsert(
    {
      id: inviteData.user.id,
      email,
      name,
      role,
      company_id: role === "gestor_unidade" ? companyId : null,
      active: true,
    },
    { onConflict: "id" },
  );

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
