import "server-only";

import { NextResponse } from "next/server";

import type { CtrlUserContext } from "@/lib/ctrl/auth";
import { runAsCtrlUser } from "@/lib/ctrl/injected-identity";
import type { CtrlOrg } from "@/lib/ctrl/orgs";
import { matchExtApiClient, type ExtApiClient } from "@/lib/ext-api/clients";
import { buildExtCtrlUser, escapeIlike, type ExtUserRow } from "@/lib/ext-api/identity";
import { createAdminClient } from "@/lib/supabase/admin";

// Porta de entrada de toda rota /api/ext/v1/ctrl/*: confere a chave do sistema
// externo, resolve QUEM age (header X-Acting-User) na empresa amarrada à chave
// e roda o handler com essa identidade injetada no Compras.

export interface ExtCtrlCall {
  client: ExtApiClient;
  ctx: CtrlUserContext;
  request: Request;
}

/** Resposta de erro no formato das APIs do projeto: `{ error }` + status. */
export function extError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

/** Converte o retorno `{ error }` das actions do Compras em 400. */
export function extFromAction<T extends object>(result: T | { error: string }) {
  if ("error" in result && typeof result.error === "string") return extError(400, result.error);
  return NextResponse.json(result);
}

async function resolveOrg(slug: string): Promise<CtrlOrg | null> {
  const { data } = await createAdminClient()
    .from("ctrl_orgs")
    .select("id, nome, slug")
    .eq("slug", slug)
    .eq("ativo", true)
    .maybeSingle();
  return (data as CtrlOrg | null) ?? null;
}

async function resolveActingUser(email: string, org: CtrlOrg) {
  const admin = createAdminClient();
  const { data: users, error } = await admin
    .from("users")
    .select(`
      id, email, name, role, profile, active, can_compras,
      user_module_roles!user_module_roles_user_id_fkey(role, module),
      user_sectors(sector_id)
    `)
    .ilike("email", escapeIlike(email))
    .limit(2);
  if (error) throw new Error(error.message);
  if ((users ?? []).length > 1) {
    return { ok: false as const, error: `Mais de um usuário com o e-mail ${email}.` };
  }
  const user = ((users ?? [])[0] ?? null) as ExtUserRow | null;

  let grant: { role: string | null } | undefined;
  if (user) {
    const { data: grantRow } = await admin
      .from("ctrl_user_orgs")
      .select("role")
      .eq("user_id", user.id)
      .eq("org_id", org.id)
      .maybeSingle();
    grant = grantRow ? { role: (grantRow as { role: string | null }).role } : undefined;
  }
  return buildExtCtrlUser(email, user, org, grant);
}

export async function withExtCtrl(
  request: Request,
  handler: (call: ExtCtrlCall) => Promise<Response>,
): Promise<Response> {
  const started = Date.now();
  const client = matchExtApiClient(request.headers.get("authorization"), process.env);
  if (!client) return extError(401, "Chave de API inválida.");

  const email = request.headers.get("x-acting-user")?.trim();
  if (!email) return extError(400, "Informe o usuário no header X-Acting-User.");

  let status = 500;
  let userId: string | null = null;
  try {
    const org = await resolveOrg(client.orgSlug);
    if (!org) {
      status = 503;
      return extError(503, `Empresa ${client.orgSlug} não encontrada no Compras.`);
    }

    const identity = await resolveActingUser(email, org);
    if (!identity.ok) {
      status = 403;
      return extError(403, identity.error);
    }
    userId = identity.ctx.id;

    const response = await runAsCtrlUser(identity.ctx, () =>
      handler({ client, ctx: identity.ctx, request }),
    );
    status = response.status;
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // requireCtrlRole lança estas duas quando o papel não alcança a ação.
    status = message === "Acesso negado." || message === "Não autenticado." ? 403 : 500;
    if (status === 500) console.error("[ext-api] unhandled", { path: new URL(request.url).pathname, message });
    return extError(status, message);
  } finally {
    console.info(
      "[ext-api]",
      JSON.stringify({
        client: client.id,
        user: userId,
        method: request.method,
        path: new URL(request.url).pathname,
        status,
        ms: Date.now() - started,
      }),
    );
  }
}
