import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserProfileType } from "@/lib/supabase/types";

const VALID_PROFILES: UserProfileType[] = [
  "admin",
  "contas_a_pagar",
  "gerente",
  "diretor",
  "validador_contrato",
  "solicitante",
];

export async function POST(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.profile !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const body = (await request.json()) as {
    email?: string;
    name?: string;
    profile?: UserProfileType;
    can_financeiro?: boolean;
    can_compras?: boolean;
    sector_ids?: string[];
    company_ids?: string[];
  };

  const email = body.email?.trim().toLowerCase();
  const name = body.name?.trim();
  const userProfile = body.profile;

  if (!email || !name || !userProfile) {
    return NextResponse.json({ error: "Informe e-mail, nome e perfil." }, { status: 400 });
  }
  if (!VALID_PROFILES.includes(userProfile)) {
    return NextResponse.json({ error: "Perfil inválido." }, { status: 400 });
  }

  // Validador de contrato: força sem módulos
  const canFinanceiro =
    userProfile === "validador_contrato" ? false : Boolean(body.can_financeiro);
  const canCompras =
    userProfile === "validador_contrato" ? false : Boolean(body.can_compras);
  const sectorIds = userProfile === "validador_contrato" ? [] : body.sector_ids ?? [];
  const companyIds = userProfile === "validador_contrato" ? [] : body.company_ids ?? [];

  // Gerente e Solicitante precisam de pelo menos um setor.
  if (
    (userProfile === "gerente" || userProfile === "solicitante") &&
    sectorIds.length === 0
  ) {
    return NextResponse.json(
      { error: "Gerente e Solicitante precisam de pelo menos um setor." },
      { status: 400 },
    );
  }

  const adminClient = createAdminClient();
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  const landingPath = userProfile === "validador_contrato" ? "/contratos" : "/dashboard";

  const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
    email,
    {
      redirectTo: `${appUrl}/auth/callback?next=${landingPath}`,
      data: { name },
    },
  );

  if (inviteError || !inviteData.user) {
    return NextResponse.json(
      { error: inviteError?.message ?? "Falha ao enviar convite." },
      { status: 400 },
    );
  }

  const newUserId = inviteData.user.id;
  const legacyDreRole = deriveLegacyDreRole(userProfile);

  const { error: upsertError } = await supabase.from("users").upsert(
    {
      id: newUserId,
      email,
      name,
      profile: userProfile,
      can_financeiro: canFinanceiro,
      can_compras: canCompras,
      contracts_only: userProfile === "validador_contrato",
      role: legacyDreRole, // compat
      company_id: null,
      active: true,
    },
    { onConflict: "id" },
  );

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 400 });
  }

  // Sectors
  if (sectorIds.length > 0) {
    const { error } = await adminClient.from("user_sectors").insert(
      Array.from(new Set(sectorIds)).map((sectorId) => ({
        user_id: newUserId,
        sector_id: sectorId,
      })),
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Companies
  if (companyIds.length > 0) {
    const { error } = await adminClient.from("user_company_access").insert(
      Array.from(new Set(companyIds)).map((companyId) => ({
        user_id: newUserId,
        company_id: companyId,
      })),
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

function deriveLegacyDreRole(p: UserProfileType): "admin" | "gestor_hero" | "gestor_unidade" {
  if (p === "admin") return "admin";
  if (p === "diretor" || p === "contas_a_pagar") return "gestor_hero";
  return "gestor_unidade";
}
