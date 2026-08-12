import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Módulo "Validação de Contratos".
 *
 * Antes era só um PERFIL (`validador_contrato`), o que tornava o acesso
 * exclusivo: quem precisava da tela não podia ter nenhum outro perfil (um
 * Gerente Sócio do módulo Compras, por exemplo, ficava de fora). Agora a tela é
 * um MÓDULO, marcável em "Módulos visíveis" na tela de Usuários, independente
 * do perfil.
 *
 * ── Onde o acesso é gravado ────────────────────────────────────────────────
 * Numa linha de `user_module_roles` (module='contratos', role='validador') —
 * a tabela "extensível: um role por módulo por usuário" que já existe. NÃO é
 * uma coluna `can_contratos` em `users` (como can_financeiro/can_compras/
 * can_case) de propósito: coluna nova exigiria migration, e enquanto a
 * migration não roda o `select` explícito das telas quebra inteiro (42703) —
 * incluindo o de `getSessionContext`, que derrubaria o app todo. A linha usa
 * só o que já está no banco e funciona no deploy.
 *
 * A sessão expõe o resultado como `profile.can_contratos`, então o resto do
 * código lê como se fosse mais uma flag de módulo.
 */
export const CONTRATOS_MODULE = "contratos";

/** Único role do módulo hoje: quem tem a linha, enxerga e opera a tela. */
export const CONTRATOS_MODULE_ROLE = "validador";

/** Rota raiz do módulo. */
export const CONTRATOS_PATH = "/contratos";

/** Chave do item no menu lateral (grupo próprio "CONTRATOS"). */
export const CONTRATOS_NAV_KEY = "contratos-validacao";

/**
 * True quando a lista de linhas de `user_module_roles` do usuário contém a
 * concessão do módulo. Aceita o formato retornado pelo join do
 * `getSessionContext` (`{ module, role }`) e o do select enxuto do middleware
 * (`{ module }`).
 */
export function hasContratosGrant(
  rows: Array<{ module?: string | null }> | null | undefined,
): boolean {
  return (rows ?? []).some((row) => row?.module === CONTRATOS_MODULE);
}

/**
 * Concede ou remove o módulo para um usuário. Escreve com o client de service
 * role (as policies de `user_module_roles` só permitem escrita de admin, e as
 * rotas que chamam isso já checaram `profile === 'admin'`).
 */
export async function setContratosGrant(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
  granted: boolean,
): Promise<{ error: string | null }> {
  if (!granted) {
    const { error } = await adminClient
      .from("user_module_roles")
      .delete()
      .eq("user_id", userId)
      .eq("module", CONTRATOS_MODULE);
    return { error: error?.message ?? null };
  }

  // Sem unique(user_id, module) na tabela (a constraint caiu quando o CTRL
  // virou multi-role), então checa antes de inserir pra não duplicar a linha.
  const { data: existing, error: readError } = await adminClient
    .from("user_module_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("module", CONTRATOS_MODULE)
    .limit(1);
  if (readError) return { error: readError.message };
  if (existing && existing.length > 0) return { error: null };

  const { error } = await adminClient.from("user_module_roles").insert({
    user_id: userId,
    module: CONTRATOS_MODULE,
    role: CONTRATOS_MODULE_ROLE,
  });
  return { error: error?.message ?? null };
}

/**
 * Lê, em lote, quem tem o módulo. Usado pelas telas/rotas de administração de
 * usuários (lista da tela Usuários e GET /api/users).
 */
export async function fetchContratosGrantUserIds(
  adminClient: ReturnType<typeof createAdminClient>,
): Promise<Set<string>> {
  const { data } = await adminClient
    .from("user_module_roles")
    .select("user_id")
    .eq("module", CONTRATOS_MODULE);
  return new Set((data ?? []).map((row) => row.user_id as string));
}
