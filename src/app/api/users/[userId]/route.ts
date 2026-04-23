import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CtrlRole, UserRole } from "@/lib/supabase/types";

// Valores aceitos para ctrl_roles no PATCH. 'admin' NAO entra aqui - e derivado
// do users.role == 'admin' no getSessionContext, nao persistido em user_module_roles.
const ASSIGNABLE_CTRL_ROLES: ReadonlyArray<Exclude<CtrlRole, "admin">> = [
  "solicitante",
  "gerente",
  "diretor",
  "csc",
  "contas_a_pagar",
  "aprovacao_fornecedor",
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
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const body = (await request.json()) as {
    name?: string;
    role?: UserRole;
    company_id?: string | null;
    active?: boolean;
    // [] = remover acesso ao modulo ctrl; undefined = nao alterar
    ctrl_roles?: CtrlRole[];
  };

  // Validacao do ctrl_roles antes de qualquer update
  if (body.ctrl_roles !== undefined) {
    if (!Array.isArray(body.ctrl_roles)) {
      return NextResponse.json({ error: "ctrl_roles deve ser um array." }, { status: 400 });
    }
    const invalid = body.ctrl_roles.find(
      (r) => !ASSIGNABLE_CTRL_ROLES.includes(r as Exclude<CtrlRole, "admin">),
    );
    if (invalid) {
      return NextResponse.json(
        { error: `ctrl_roles contem valor invalido: "${invalid}". Use apenas: ${ASSIGNABLE_CTRL_ROLES.join(", ")}.` },
        { status: 400 },
      );
    }
  }

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

  const adminClient = createAdminClient();

  if (Object.keys(patch).length > 0) {
    const { data, error } = await adminClient
      .from("users")
      .update(patch)
      .eq("id", params.userId)
      .select("id, role, name, company_id");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ error: "Usuario nao encontrado." }, { status: 404 });
    }
  }

  // Sincroniza ctrl_roles em user_module_roles (module='ctrl') quando informado.
  // Estrategia: apaga todas as linhas do usuario no modulo e insere o novo conjunto.
  if (body.ctrl_roles !== undefined) {
    const { error: delError } = await adminClient
      .from("user_module_roles")
      .delete()
      .eq("user_id", params.userId)
      .eq("module", "ctrl");
    if (delError) {
      return NextResponse.json({ error: delError.message }, { status: 400 });
    }

    // Dedup + filtro 'admin' (derivado, nao deve ser persistido).
    const toInsert = Array.from(new Set(body.ctrl_roles.filter((r) => r !== "admin")));
    if (toInsert.length > 0) {
      const { error: insertError } = await adminClient
        .from("user_module_roles")
        .insert(
          toInsert.map((role) => ({
            user_id: params.userId,
            module: "ctrl",
            role,
            granted_by: profile.id,
          })),
        );
      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 400 });
      }
    }
  }

  return NextResponse.json({ ok: true });
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
