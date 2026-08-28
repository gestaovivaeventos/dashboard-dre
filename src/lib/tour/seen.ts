import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * "Este usuário já viu o tour de boas-vindas."
 *
 * O tour guiado aparece UMA vez por pessoa — no primeiro acesso dela ao Control
 * Hub. Depois disso só volta pelo "?" ao lado do módulo, no menu.
 *
 * ── Onde a marca é gravada ─────────────────────────────────────────────────
 * Numa linha de `user_module_roles` (module='tour', role='seen'), o mesmo
 * caminho do módulo Validação de Contratos (ver @/lib/auth/contratos). NÃO é
 * uma coluna nova em `users`, de propósito: coluna nova exige migration, e
 * enquanto ela não roda o `select` explícito de `getSessionContext` quebra
 * inteiro (42703) e derruba o app. Aqui a marca usa só o que já existe no
 * banco e funciona no mesmo deploy — que é justamente o que faz a regra "só
 * na próxima entrada" valer para quem já usava o sistema.
 *
 * A linha é inerte para permissão: toda leitura de `user_module_roles`, no app
 * e nas funções do banco (`get_ctrl_role`, `has_ctrl_role`), filtra por
 * `module = 'ctrl'` ou `module = 'contratos'`. Se um dia alguém ler a tabela
 * sem filtrar módulo, esta linha vira um papel fantasma — filtre.
 *
 * ── Por que não localStorage ───────────────────────────────────────────────
 * localStorage é por navegador: a mesma pessoa veria o tour de novo no
 * notebook, no celular e depois de limpar os dados do site. "Uma vez por
 * usuário" só se sustenta no servidor.
 */
export const TOUR_MODULE = "tour";

/** Único "papel" do módulo: a marca de que o tour já foi apresentado. */
export const TOUR_MODULE_ROLE = "seen";

/**
 * True quando a lista de linhas de `user_module_roles` já traz a marca.
 * Aceita o formato do join do `getSessionContext` (`{ module, role }`) e o do
 * select enxuto do middleware (`{ module }`).
 */
export function hasSeenTour(
  rows: Array<{ module?: string | null }> | null | undefined,
): boolean {
  return (rows ?? []).some((row) => row?.module === TOUR_MODULE);
}

/**
 * Marca o tour como visto. Escreve com o client de service role: as policies de
 * `user_module_roles` só permitem escrita de admin, e quem chama isso é a rota
 * que já resolveu o usuário pela sessão — nunca por id vindo do cliente.
 *
 * Idempotente: chamar de novo não duplica a linha nem falha.
 */
export async function markTourSeen(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<{ error: string | null }> {
  const { data: existing, error: readError } = await adminClient
    .from("user_module_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("module", TOUR_MODULE)
    .limit(1);
  if (readError) return { error: readError.message };
  if (existing && existing.length > 0) return { error: null };

  const { error } = await adminClient.from("user_module_roles").insert({
    user_id: userId,
    module: TOUR_MODULE,
    role: TOUR_MODULE_ROLE,
  });
  return { error: error?.message ?? null };
}
