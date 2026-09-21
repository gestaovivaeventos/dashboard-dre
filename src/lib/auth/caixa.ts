import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Módulo "Caixa" — saldo das contas correntes de todas as empresas do grupo,
 * lido da Omie.
 *
 * ── Onde o acesso é gravado ────────────────────────────────────────────────
 * Numa linha de `user_module_roles` (module='caixa', role='user'), o mesmo
 * caminho dos módulos Validação de Contratos e VB: nada de coluna nova em
 * `users`. O motivo é o mesmo já documentado em @/lib/auth/contratos — coluna
 * nova exige migration, e enquanto ela não roda o `select` explícito de
 * `getSessionContext` quebra inteiro (42703) e derruba o app.
 *
 * A sessão expõe o resultado como `profile.can_caixa`, então o resto do código
 * lê como se fosse mais uma flag de módulo.
 *
 * ── Admin herda ────────────────────────────────────────────────────────────
 * Diferente do VB, aqui `profile === 'admin'` JÁ dá acesso (modelo do Case e
 * do Contratos). Quem não é admin depende da marcação em "Módulos visíveis".
 *
 * ── Este módulo NÃO herda a regra de empresas restritas ─────────────────────
 * Decisão explícita do dono do projeto (17/09/2026), não esquecimento: quem
 * tem o módulo Caixa vê o saldo de TODAS as empresas, Dataforte inclusive.
 * Isso diverge de propósito de @/lib/auth/restricted-companies, que vale para
 * o Business Intelligence e os Documentos anexos — as outras duas telas de
 * escopo global. A justificativa é que o Caixa é um módulo à parte, com regras
 * próprias: a pergunta que ele responde ("quanto o grupo tem em caixa agora")
 * só faz sentido com o grupo inteiro na conta, e uma empresa escondida
 * devolveria um total errado sem avisar ninguém.
 *
 * Ao aplicar `restrictedCompanyIds` numa tela nova, NÃO inclua o Caixa achando
 * que ele ficou de fora por descuido.
 *
 * Client-safe: só constantes e funções puras (o `setCaixaGrant` recebe o
 * client de fora, não importa nada de servidor).
 */
export const CAIXA_MODULE = "caixa";

/** Único role do módulo hoje: quem tem a linha, enxerga e opera as telas. */
export const CAIXA_MODULE_ROLE = "user";

/** Rota raiz do módulo. */
export const CAIXA_PATH = "/caixa";

/** Primeira (e por ora única) tela: Caixa Geral (rota /caixa/real — o nome de tela mudou, a URL não). */
export const CAIXA_REAL_PATH = "/caixa/real";

/** Chave do item no menu lateral (grupo próprio "CAIXA"). */
export const CAIXA_NAV_KEY_REAL = "caixa-real";

/**
 * True quando a lista de linhas de `user_module_roles` do usuário contém a
 * concessão do módulo. Aceita o formato do join do `getSessionContext`
 * (`{ module, role }`) e o do select enxuto do middleware (`{ module }`).
 *
 * NÃO considera admin — quem chama compõe com o perfil, porque o middleware,
 * a root page e a sessão leem o perfil de lugares diferentes.
 */
export function hasCaixaGrant(
  rows: Array<{ module?: string | null }> | null | undefined,
): boolean {
  return (rows ?? []).some((row) => row?.module === CAIXA_MODULE);
}

export function isCaixaPath(pathname: string): boolean {
  return pathname === CAIXA_PATH || pathname.startsWith(`${CAIXA_PATH}/`);
}

/**
 * Concede ou remove o módulo para um usuário. Escreve com o client de service
 * role (as policies de `user_module_roles` só permitem escrita de admin, e as
 * rotas que chamam isso já checaram `profile === 'admin'`).
 */
export async function setCaixaGrant(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
  granted: boolean,
): Promise<{ error: string | null }> {
  if (!granted) {
    const { error } = await adminClient
      .from("user_module_roles")
      .delete()
      .eq("user_id", userId)
      .eq("module", CAIXA_MODULE);
    return { error: error?.message ?? null };
  }

  // Sem unique(user_id, module) na tabela (a constraint caiu quando o CTRL
  // virou multi-role), então checa antes de inserir pra não duplicar a linha.
  const { data: existing, error: readError } = await adminClient
    .from("user_module_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("module", CAIXA_MODULE)
    .limit(1);
  if (readError) return { error: readError.message };
  if (existing && existing.length > 0) return { error: null };

  const { error } = await adminClient.from("user_module_roles").insert({
    user_id: userId,
    module: CAIXA_MODULE,
    role: CAIXA_MODULE_ROLE,
  });
  return { error: error?.message ?? null };
}

/**
 * Lê, em lote, quem tem a concessão. Usado pelas telas/rotas de administração
 * de usuários (lista da tela Usuários e GET /api/users).
 */
export async function fetchCaixaGrantUserIds(
  adminClient: ReturnType<typeof createAdminClient>,
): Promise<Set<string>> {
  const { data } = await adminClient
    .from("user_module_roles")
    .select("user_id")
    .eq("module", CAIXA_MODULE);
  return new Set((data ?? []).map((row) => row.user_id as string));
}
