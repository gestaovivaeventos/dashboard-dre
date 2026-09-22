import { getCurrentSessionContext } from "@/lib/auth/session";
import type { OrcamentoPapel } from "@/lib/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Guard do módulo Orçamento.
 *
 * O módulo era ADMIN-ONLY: uma função só (`getOrcamentoAdmin`) protegia todas
 * as actions, e quem não fosse admin não entrava em lugar nenhum. Com o ciclo
 * construção → validação → retorno, os construtores passaram a ser os GERENTES
 * (cada um nos seus setores) e a diretoria valida — então o guard precisa
 * responder três perguntas, não uma:
 *
 *   1. entra no módulo?            → `getOrcamentoUser()`
 *   2. alcança ESTA empresa?       → `podeVerEmpresa()` / `assertEmpresa()`
 *   3. alcança ESTE setor?         → `setoresDeLeitura()` / `setoresDeEscrita()`
 *
 * O escopo não é um cadastro novo: empresa vem de `user_company_access` e setor
 * de `user_sectors` (o cadastro do COMPRAS), atravessando para o orçamento pela
 * ponte `orcamento_setores.ctrl_sector_id`.
 *
 * ── Quem faz o quê nesta fase ──────────────────────────────────────────────
 *  - `admin`            → tudo, todas as empresas, inclusive a configuração.
 *  - `validador`        → LEITURA das empresas dele. A edição da diretoria é a
 *                         etapa de validação, que ainda não existe (fase C):
 *                         enquanto não há ciclo, tudo está "em construção" e,
 *                         nessa fase, o validador lê. Liberar a escrita agora
 *                         seria edição sem trilha e sem trava — exatamente o
 *                         que o ciclo existe para evitar.
 *  - `construtor_amplo` → ("Gerente Sócio") lê a empresa inteira, escreve nos
 *                         setores vinculados a ele.
 *  - `construtor`       → ("Gerente") lê e escreve só nos setores dele.
 */
export interface OrcamentoUser {
  userId: string;
  papel: OrcamentoPapel;
  /** Atalho: papel === 'admin'. */
  isAdmin: boolean;
  /** Empresas de `user_company_access`; "todas" para admin. */
  companyIds: string[] | "todas";
  /**
   * Setores do COMPRAS vinculados ao usuário (`user_sectors`). É a chave da
   * ponte: `orcamento_setores.ctrl_sector_id` aponta para `ctrl_sectors`, não
   * para um cadastro próprio do orçamento.
   */
  ctrlSectorIds: string[];
}

/** Mensagem única de negativa — as actions devolvem `{ error }`, não exceção. */
export const SEM_ACESSO = "Você não tem acesso a este orçamento.";
export const SEM_ACESSO_ADMIN = "Acesso restrito a administradores.";
export const SEM_ACESSO_SETOR =
  "Você só pode alterar o orçamento dos setores vinculados a você.";

/**
 * Usuário do módulo, ou `null` quando não tem acesso. O papel é resolvido na
 * sessão (perfil + concessão em user_module_roles) — ver @/lib/auth/orcamento.
 */
export async function getOrcamentoUser(): Promise<OrcamentoUser | null> {
  const { profile, modules } = await getCurrentSessionContext();
  const papel = modules?.orcamento?.papel ?? null;
  if (!profile || !papel) return null;

  return {
    userId: profile.id,
    papel,
    isAdmin: papel === "admin",
    companyIds: papel === "admin" ? "todas" : profile.company_ids,
    ctrlSectorIds: profile.sector_ids,
  };
}

/**
 * Guard das telas de CONFIGURAÇÃO do módulo (método por categoria, plano de
 * cargos, encargos, índices, cadastro de setores). Continua admin-only: um
 * gerente constrói o orçamento, não redefine as premissas dele. Espelha
 * `isOrcamentoConfigPath` em @/lib/auth/access.
 */
export async function getOrcamentoAdmin(): Promise<{ userId: string } | null> {
  const user = await getOrcamentoUser();
  if (!user?.isAdmin) return null;
  return { userId: user.userId };
}

/** True quando o usuário alcança a empresa. */
export function podeVerEmpresa(user: OrcamentoUser, companyId: string): boolean {
  if (user.companyIds === "todas") return true;
  return user.companyIds.includes(companyId);
}

/** True quando o usuário pode ESCREVER no orçamento da empresa. */
export function podeEditarEmpresa(user: OrcamentoUser, companyId: string): boolean {
  if (!podeVerEmpresa(user, companyId)) return false;
  // O validador (diretoria) ainda não escreve — ver o cabeçalho deste arquivo.
  return user.papel !== "validador";
}

/**
 * Ids de `orcamento_setores` que o usuário alcança na empresa × ano, ou `null`
 * quando alcança TODOS (admin, validador e Gerente Sócio na leitura).
 *
 * Lista VAZIA é diferente de `null`: significa "nenhum setor" — é o que
 * acontece com um gerente cujos setores não têm a ponte `ctrl_sector_id`
 * preenchida. A tela de Setores avisa sobre isso; aqui a consequência é ver
 * nada, nunca ver tudo. Falhar para o lado de esconder é deliberado.
 */
export async function setoresDeLeitura(
  supabase: SupabaseClient,
  user: OrcamentoUser,
  companyId: string,
  year: number,
): Promise<string[] | null> {
  if (user.isAdmin || user.papel === "validador" || user.papel === "construtor_amplo") {
    return null;
  }
  return resolverSetoresDoUsuario(supabase, user, companyId, year);
}

/**
 * Ids de `orcamento_setores` em que o usuário pode ESCREVER, ou `null` para
 * todos (só admin). O Gerente Sócio lê a empresa inteira mas escreve só nos
 * setores dele — é aqui que os dois papéis de construtor se separam.
 */
export async function setoresDeEscrita(
  supabase: SupabaseClient,
  user: OrcamentoUser,
  companyId: string,
  year: number,
): Promise<string[] | null> {
  if (user.isAdmin) return null;
  if (user.papel === "validador") return [];
  return resolverSetoresDoUsuario(supabase, user, companyId, year);
}

/**
 * A ponte, numa consulta: `user_sectors` (Compras) → `orcamento_setores` da
 * empresa × ano, por `ctrl_sector_id`.
 */
async function resolverSetoresDoUsuario(
  supabase: SupabaseClient,
  user: OrcamentoUser,
  companyId: string,
  year: number,
): Promise<string[]> {
  if (user.ctrlSectorIds.length === 0) return [];
  const { data, error } = await supabase
    .from("orcamento_setores")
    .select("id")
    .eq("company_id", companyId)
    .eq("year", year)
    .in("ctrl_sector_id", user.ctrlSectorIds);
  if (error || !data) return [];
  return data.map((r) => r.id as string);
}

/**
 * Guard completo de uma LEITURA de empresa × ano: usuário do módulo, ano
 * válido e empresa no escopo. Devolve também os setores que ele enxerga
 * (`null` = todos), para a action filtrar sem repetir a regra.
 */
export async function autorizarLeitura(
  supabase: SupabaseClient,
  companyId: string,
  year: number,
): Promise<
  | { ok: true; user: OrcamentoUser; setores: string[] | null }
  | { ok: false; error: string }
> {
  const user = await getOrcamentoUser();
  if (!user) return { ok: false, error: SEM_ACESSO };
  if (!podeVerEmpresa(user, companyId)) return { ok: false, error: SEM_ACESSO };
  const setores = await setoresDeLeitura(supabase, user, companyId, year);
  return { ok: true, user, setores };
}

/**
 * Guard completo de uma ESCRITA: tudo o que a leitura confere, mais o papel
 * (a diretoria ainda não escreve) e os setores em que ele pode gravar.
 *
 * Quem chama ainda precisa validar o SETOR DE DESTINO com
 * `podeEscreverNoSetor(res.setores, alvo)` — o destino só é conhecido depois de
 * `setorParaGravar`, que resolve "Todos os setores" para o balde "Não
 * atribuído". É de propósito que um construtor não consiga gravar ali: linha
 * sem dono não é dele.
 */
export async function autorizarEscrita(
  supabase: SupabaseClient,
  companyId: string,
  year: number,
): Promise<
  | { ok: true; user: OrcamentoUser; setores: string[] | null }
  | { ok: false; error: string }
> {
  const user = await getOrcamentoUser();
  if (!user) return { ok: false, error: SEM_ACESSO };
  if (!podeEditarEmpresa(user, companyId)) {
    return {
      ok: false,
      error:
        user.papel === "validador"
          ? "A diretoria ainda não edita o orçamento — a etapa de validação será liberada em breve."
          : SEM_ACESSO,
    };
  }
  const setores = await setoresDeEscrita(supabase, user, companyId, year);
  return { ok: true, user, setores };
}

/**
 * Confere se o usuário pode escrever numa linha de um setor específico.
 * `setorId` nulo (linha sem setor) só é permitido a admin — uma linha sem setor
 * não pertence a gerente nenhum.
 */
export function podeEscreverNoSetor(
  permitidos: string[] | null,
  setorId: string | null,
): boolean {
  if (permitidos === null) return true; // admin
  if (!setorId) return false;
  return permitidos.includes(setorId);
}
