import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import type { CtrlUserContext } from "@/lib/ctrl/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Identidade do Compras vinda de FORA da sessão por cookie — hoje só a API
// externa (/api/ext/v1/ctrl/*, usada pelo hubfeat). A rota resolve o usuário e
// roda a action dentro de `runAsCtrlUser`; `getCtrlUser` lê daqui antes de
// olhar o cookie, então as actions não mudam de assinatura nem duplicam regra.
// Ver docs/superpowers/specs/2026-10-08-ctrl-api-hubfeat-design.md.

const store = new AsyncLocalStorage<CtrlUserContext>();

export function runAsCtrlUser<T>(ctx: CtrlUserContext, fn: () => Promise<T>): Promise<T> {
  return store.run(ctx, fn);
}

export function getInjectedCtrlUser(): CtrlUserContext | null {
  return store.getStore() ?? null;
}

/**
 * Client para as LEITURAS que hoje confiam na RLS do usuário. Sem cookie, o
 * client do usuário é anônimo e a leitura voltaria vazia; com identidade
 * injetada vai o admin client. Só use onde a action JÁ filtra por código
 * (org_id, user_sectors, created_by) — senão o admin client abriria a leitura
 * da empresa inteira.
 */
export async function ctrlReadClient() {
  return getInjectedCtrlUser() ? createAdminClient() : await createClient();
}
