import { NextResponse } from "next/server";

import { resolveAppUrl } from "@/lib/app-url";
import { setContratosGrant } from "@/lib/auth/contratos";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserProfileType } from "@/lib/supabase/types";

const VALID_PROFILES: UserProfileType[] = [
  "admin",
  "contas_a_pagar",
  "gerente",
  "gerente_setor",
  "diretor",
  "validador_contrato",
  "solicitante",
  "franqueado",
  // CSC: cópia funcional do "franqueado" (Visão Financeira) + tela Validação
  // Relatório. As mesmas restrições de módulo/setor abaixo se aplicam.
  "csc",
];

export async function POST(request: Request) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.profile !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const body = (await request.json()) as {
    email?: string;
    name?: string;
    phone?: string;
    position?: string;
    profile?: UserProfileType;
    can_financeiro?: boolean;
    can_compras?: boolean;
    can_case?: boolean;
    can_viagens?: boolean;
    can_viagens_aprovar?: boolean;
    can_contratos?: boolean;
    sector_ids?: string[];
    company_ids?: string[];
  };

  const email = body.email?.trim().toLowerCase();
  const name = body.name?.trim();
  const phone = body.phone?.trim() || null;
  const position = body.position?.trim() || null;
  const userProfile = body.profile;

  if (!email || !name || !userProfile) {
    return NextResponse.json({ error: "Informe e-mail, nome e perfil." }, { status: 400 });
  }
  if (!VALID_PROFILES.includes(userProfile)) {
    return NextResponse.json({ error: "Perfil inválido." }, { status: 400 });
  }

  // Validador de contrato: força sem módulos
  // Franqueado e CSC (cópia funcional): força só Financeiro, sem setores
  const isFinanceiroOnly =
    userProfile === "franqueado" || userProfile === "csc";
  const canFinanceiro =
    userProfile === "validador_contrato"
      ? false
      : isFinanceiroOnly
      ? true
      : Boolean(body.can_financeiro);
  const canCompras =
    userProfile === "validador_contrato" || isFinanceiroOnly
      ? false
      : Boolean(body.can_compras);
  const canCase =
    userProfile === "validador_contrato" || isFinanceiroOnly
      ? false
      : Boolean(body.can_case);
  const canViagens =
    userProfile === "validador_contrato" || isFinanceiroOnly
      ? false
      : Boolean(body.can_viagens);
  const canViagensAprovar = canViagens && Boolean(body.can_viagens_aprovar);
  // Módulo Validação de Contratos: o perfil validador sempre tem; os demais
  // seguem a marcação da tela — inclusive franqueado/CSC, que são fixos no
  // Financeiro mas podem receber este módulo, que é independente.
  const canContratos =
    userProfile === "validador_contrato" ? true : Boolean(body.can_contratos);
  const sectorIds =
    userProfile === "validador_contrato" || isFinanceiroOnly
      ? []
      : body.sector_ids ?? [];
  const companyIds = userProfile === "validador_contrato" ? [] : body.company_ids ?? [];

  // Gerente (sócio e de setor) e Solicitante precisam de pelo menos um setor.
  if (
    (userProfile === "gerente" ||
      userProfile === "gerente_setor" ||
      userProfile === "solicitante") &&
    sectorIds.length === 0
  ) {
    return NextResponse.json(
      { error: "Gerente e Solicitante precisam de pelo menos um setor." },
      { status: 400 },
    );
  }

  const adminClient = createAdminClient();
  const appUrl = resolveAppUrl();

  const landingPath =
    userProfile === "validador_contrato" ? "/contratos" : "/dashboard";

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

  // IMPORTANTE: usar adminClient pra burlar RLS de users.
  // A policy "Users can insert own profile" exige id = auth.uid(); como
  // estamos criando perfil pra OUTRO usuario, precisamos do service role.
  // O check de role admin acima ja garante seguranca.
  const { error: upsertError } = await adminClient.from("users").upsert(
    {
      id: newUserId,
      email,
      name,
      phone,
      position,
      profile: userProfile,
      can_financeiro: canFinanceiro,
      can_compras: canCompras,
      can_case: canCase,
      can_viagens: canViagens,
      can_viagens_aprovar: canViagensAprovar,
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

  // Módulo Validação de Contratos (linha em user_module_roles)
  if (canContratos) {
    const { error } = await setContratosGrant(adminClient, newUserId, true);
    if (error) return NextResponse.json({ error }, { status: 400 });
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
