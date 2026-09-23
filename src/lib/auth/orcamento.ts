import type { createAdminClient } from "@/lib/supabase/admin";
import type { OrcamentoPapel, UserProfileType } from "@/lib/supabase/types";

/**
 * Módulo "Orçamento" — planejamento orçamentário (empresa × ano × categoria ×
 * setor).
 *
 * ── O que mudou ────────────────────────────────────────────────────────────
 * O módulo nasceu ADMIN-ONLY em todas as camadas (`getOrcamentoAdmin`, RLS
 * `is_admin()`, `dreRoles: ["admin"]` no menu, `/orcamento` negado em
 * access.ts). Isso bastava enquanto só o administrador montava o orçamento,
 * mas o processo real tem três etapas — construção, validação e retorno — e os
 * construtores são os GERENTES (cada um nos seus setores) e o próprio admin,
 * enquanto a diretoria valida. Este arquivo é a fonte de verdade desse acesso.
 *
 * ── Onde o acesso é gravado ────────────────────────────────────────────────
 * Numa linha de `user_module_roles` (module='orcamento'), o mesmo caminho de
 * Caixa, Contratos e VB — nada de coluna `can_orcamento` em `users`. O motivo
 * já documentado em @/lib/auth/contratos: coluna nova exige migration, e
 * enquanto ela não roda o `select` explícito de `getSessionContext` quebra
 * inteiro (42703) e derruba o app. A sessão expõe como `profile.can_orcamento`.
 *
 * ── Admin herda ────────────────────────────────────────────────────────────
 * Como no Case, Contratos e Caixa (e ao contrário do VB): `profile === 'admin'`
 * já entra sem a linha. O perfil `validador_contrato` segue ilha e não alcança
 * o módulo nem com a concessão — a regra vive em access.ts, que decide a ilha
 * antes de qualquer outro módulo.
 *
 * ── O PAPEL dentro do módulo vem do perfil, não de um cadastro novo ─────────
 * admin → tudo; diretor → valida; gerente ("Gerente Sócio") → vê a empresa
 * inteira e edita os seus setores; gerente_setor ("Gerente") → só os seus
 * setores. É a MESMA distinção gerente × gerente_setor que já vale na tela
 * /ctrl/orcamento do módulo Compras — reaproveitada de propósito, para não
 * criar um terceiro vocabulário de papéis no sistema.
 *
 * Escape hatch: a coluna `role` da linha de concessão aceita 'construtor' ou
 * 'validador' e, quando preenchida com um desses, SOBREPÕE o perfil. É a saída
 * para quem precise de papel no Orçamento diferente do que tem no Compras. A
 * tela de Usuários grava sempre ORCAMENTO_MODULE_ROLE_DEFAULT ('auto'); o
 * override é manual no banco, por enquanto.
 *
 * Client-safe: só constantes e funções puras (o `setOrcamentoGrant` recebe o
 * client de fora, não importa nada de servidor).
 */
export const ORCAMENTO_MODULE = "orcamento";

/**
 * Role gravado pela tela de Usuários: "o papel vem do perfil". Um valor
 * explícito ('construtor' | 'validador') na mesma coluna sobrepõe o perfil.
 */
export const ORCAMENTO_MODULE_ROLE_DEFAULT = "auto";

/** Rota raiz do módulo. */
export const ORCAMENTO_PATH = "/orcamento";

/** Chaves dos itens no menu lateral (grupo próprio "ORÇAMENTO"). */
export const ORCAMENTO_NAV_KEY_PAINEL = "orc-home";
export const ORCAMENTO_NAV_KEY_CONFIG = "orc-config";

/**
 * Perfis que podem receber o módulo. Os demais (solicitante, contas_a_pagar,
 * franqueado, csc, validador_contrato) não constroem nem validam orçamento —
 * marcar o módulo para eles não faz nada, a menos que haja override explícito
 * no `role` da linha.
 */
const PERFIS_ELEGIVEIS: ReadonlySet<UserProfileType> = new Set<UserProfileType>([
  "admin",
  "diretor",
  "gerente",
  "gerente_setor",
]);

/**
 * True quando o perfil pode receber o módulo. A tela de Usuários usa isto para
 * só oferecer o botão a quem ele faria efeito — marcar o módulo para um
 * solicitante não daria acesso nenhum, e um botão que não faz nada é pior do
 * que botão nenhum. Mesma lista usada por `resolveOrcamentoPapel`, de propósito.
 */
export function isOrcamentoEligibleProfile(profile: UserProfileType | null): boolean {
  return profile !== null && PERFIS_ELEGIVEIS.has(profile);
}

/**
 * True quando a lista de linhas de `user_module_roles` do usuário contém a
 * concessão do módulo. Aceita o formato do join do `getSessionContext`
 * (`{ module, role }`) e o do select enxuto do middleware (`{ module }`).
 *
 * NÃO considera admin — quem chama compõe com o perfil, porque o middleware, a
 * root page e a sessão leem o perfil de lugares diferentes.
 */
export function hasOrcamentoGrant(
  rows: Array<{ module?: string | null }> | null | undefined,
): boolean {
  return (rows ?? []).some((row) => row?.module === ORCAMENTO_MODULE);
}

/**
 * Papel gravado explicitamente na linha de concessão, quando houver. 'auto'
 * (o padrão) devolve null — o papel sai do perfil.
 */
function papelOverride(
  rows: Array<{ module?: string | null; role?: string | null }> | null | undefined,
): OrcamentoPapel | null {
  for (const row of rows ?? []) {
    if (row?.module !== ORCAMENTO_MODULE) continue;
    if (row.role === "validador") return "validador";
    if (row.role === "construtor") return "construtor";
  }
  return null;
}

/**
 * Papel do usuário dentro do módulo, ou null quando não tem acesso.
 *
 * A concessão diz SE entra; o perfil diz COMO. Admin entra sem a linha; os
 * demais precisam dela e de um perfil elegível, salvo override explícito.
 */
export function resolveOrcamentoPapel(
  profile: UserProfileType | null,
  rows: Array<{ module?: string | null; role?: string | null }> | null | undefined,
): OrcamentoPapel | null {
  // Ilha: só /contratos, mesmo com a concessão marcada por engano.
  if (profile === "validador_contrato") return null;

  // O OVERRIDE vem antes do atalho de admin, de propósito — e é o que permite
  // "ver como": um admin que grave `role='validador'` (ou 'construtor') na
  // própria linha de concessão passa a viver as MESMAS limitações do papel,
  // inclusive as que o admin normalmente não sente (o gate por campo em média e
  // valor fixo, a trava do item, o recorte por empresa e por setor).
  //
  // Só REDUZ privilégio, nunca amplia, e exige uma linha escrita à mão: a tela
  // de Usuários grava sempre 'auto'. Para voltar a ser admin no módulo, troque o
  // role de volta para 'auto' (ou apague a linha).
  const override = papelOverride(rows);
  if (override) return override;

  if (profile === "admin") return "admin";

  const concedido = hasOrcamentoGrant(rows);
  if (!concedido) return null;

  if (!profile || !PERFIS_ELEGIVEIS.has(profile)) return null;

  switch (profile) {
    case "diretor":
      return "validador";
    case "gerente":
      return "construtor_amplo";
    case "gerente_setor":
      return "construtor";
    default:
      return null;
  }
}

/** Atalho booleano: tem acesso ao módulo (qualquer papel). */
export function canAccessOrcamento(
  profile: UserProfileType | null,
  rows: Array<{ module?: string | null; role?: string | null }> | null | undefined,
): boolean {
  return resolveOrcamentoPapel(profile, rows) !== null;
}

export function isOrcamentoPath(pathname: string): boolean {
  return pathname === ORCAMENTO_PATH || pathname.startsWith(`${ORCAMENTO_PATH}/`);
}

/**
 * Telas de CONFIGURAÇÃO do módulo, que seguem admin-only mesmo para quem tem o
 * módulo: as Configurações gerais (índices, globais) e o sub-hub de config por
 * empresa (método por categoria, plano de cargos, encargos, setores…). Um
 * gerente constrói o orçamento; ele não redefine as premissas dele.
 */
export function isOrcamentoConfigPath(pathname: string): boolean {
  if (!isOrcamentoPath(pathname)) return false;
  if (pathname.startsWith(`${ORCAMENTO_PATH}/configuracoes-gerais`)) return true;
  // /orcamento/empresa/<id>/<ano>/config[...]
  return /^\/orcamento\/empresa\/[^/]+\/[^/]+\/config(\/|$)/.test(pathname);
}

/**
 * Concede ou remove o módulo para um usuário. Escreve com o client de service
 * role (as policies de `user_module_roles` só permitem escrita de admin, e as
 * rotas que chamam isso já checaram `profile === 'admin'`).
 */
export async function setOrcamentoGrant(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
  granted: boolean,
): Promise<{ error: string | null }> {
  if (!granted) {
    const { error } = await adminClient
      .from("user_module_roles")
      .delete()
      .eq("user_id", userId)
      .eq("module", ORCAMENTO_MODULE);
    return { error: error?.message ?? null };
  }

  // Sem unique(user_id, module) na tabela (a constraint caiu quando o CTRL
  // virou multi-role), então checa antes de inserir pra não duplicar a linha.
  const { data: existing, error: readError } = await adminClient
    .from("user_module_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("module", ORCAMENTO_MODULE)
    .limit(1);
  if (readError) return { error: readError.message };
  if (existing && existing.length > 0) return { error: null };

  const { error } = await adminClient.from("user_module_roles").insert({
    user_id: userId,
    module: ORCAMENTO_MODULE,
    role: ORCAMENTO_MODULE_ROLE_DEFAULT,
  });
  return { error: error?.message ?? null };
}

/**
 * Lê, em lote, quem tem a concessão. Usado pelas telas/rotas de administração
 * de usuários (lista da tela Usuários e GET /api/users).
 */
export async function fetchOrcamentoGrantUserIds(
  adminClient: ReturnType<typeof createAdminClient>,
): Promise<Set<string>> {
  const { data } = await adminClient
    .from("user_module_roles")
    .select("user_id")
    .eq("module", ORCAMENTO_MODULE);
  return new Set((data ?? []).map((row) => row.user_id as string));
}
