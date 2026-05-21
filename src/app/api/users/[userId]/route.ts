import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserProfileType } from "@/lib/supabase/types";

const ASSIGNABLE_PROFILES: ReadonlyArray<UserProfileType> = [
  "admin",
  "contas_a_pagar",
  "gerente",
  "diretor",
  "validador_contrato",
  "solicitante",
];

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
  if (profile.profile !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const body = (await request.json()) as {
    name?: string;
    profile?: UserProfileType;
    can_financeiro?: boolean;
    can_compras?: boolean;
    active?: boolean;
    /** Lista de IDs de setores. [] = limpa vínculos. undefined = não altera. */
    sector_ids?: string[];
    /** Lista de IDs de empresas (unidades). [] = limpa. undefined = não altera. */
    company_ids?: string[];
  };

  if (body.profile !== undefined && !ASSIGNABLE_PROFILES.includes(body.profile)) {
    return NextResponse.json(
      { error: `profile inválido. Use: ${ASSIGNABLE_PROFILES.join(", ")}.` },
      { status: 400 },
    );
  }

  const adminClient = createAdminClient();

  // ── Patch users row ──
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") patch.name = body.name.trim();
  if (body.profile !== undefined) {
    patch.profile = body.profile;
    // Mantém o flag legado contracts_only em sincronia
    patch.contracts_only = body.profile === "validador_contrato";
  }
  if (body.can_financeiro !== undefined) patch.can_financeiro = body.can_financeiro;
  if (body.can_compras !== undefined) patch.can_compras = body.can_compras;
  if (body.active !== undefined) patch.active = body.active;

  // Validador de contrato nunca tem módulos marcados (não enxerga nada além)
  if (body.profile === "validador_contrato") {
    patch.can_financeiro = false;
    patch.can_compras = false;
  }

  if (Object.keys(patch).length > 0) {
    const { data, error } = await adminClient
      .from("users")
      .update(patch)
      .eq("id", params.userId)
      .select("id");

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data || data.length === 0) {
      return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
    }
  }

  // ── Sync sectors ──
  if (body.sector_ids !== undefined) {
    const { error: delErr } = await adminClient
      .from("user_sectors")
      .delete()
      .eq("user_id", params.userId);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });

    const sectorIds = Array.from(new Set(body.sector_ids));
    if (sectorIds.length > 0) {
      const { error: insErr } = await adminClient.from("user_sectors").insert(
        sectorIds.map((sectorId) => ({ user_id: params.userId, sector_id: sectorId })),
      );
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });
    }
  }

  // ── Sync companies (unidades) ──
  if (body.company_ids !== undefined) {
    const { error: delErr } = await adminClient
      .from("user_company_access")
      .delete()
      .eq("user_id", params.userId);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });

    const companyIds = Array.from(new Set(body.company_ids));
    if (companyIds.length > 0) {
      const { error: insErr } = await adminClient.from("user_company_access").insert(
        companyIds.map((companyId) => ({ user_id: params.userId, company_id: companyId })),
      );
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });
    }
  }

  // ── Sync the legacy `role` column so old code keeps working ──
  if (body.profile !== undefined) {
    const legacyRole = deriveLegacyDreRole(body.profile);
    await adminClient.from("users").update({ role: legacyRole }).eq("id", params.userId);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.profile !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const { error } = await supabase
    .from("users")
    .update({ active: false })
    .eq("id", params.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  try {
    const adminClient = createAdminClient();
    await adminClient.auth.admin.updateUserById(params.userId, { ban_duration: "876000h" });
  } catch {
    // Soft delete at application-level is the primary safeguard.
  }

  return NextResponse.json({ ok: true });
}

function deriveLegacyDreRole(p: UserProfileType): "admin" | "gestor_hero" | "gestor_unidade" {
  if (p === "admin") return "admin";
  if (p === "diretor" || p === "contas_a_pagar") return "gestor_hero";
  return "gestor_unidade";
}
