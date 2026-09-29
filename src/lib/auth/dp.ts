/**
 * Módulo Departamento Pessoal (DP) — folha, admissão, férias, ponto, eSocial…
 * Construído aos poucos; esta é a fonte de verdade do ACESSO.
 *
 * ── Módulo SIGILOSO ─────────────────────────────────────────────────────────
 * Vai guardar salário, CPF, dados bancários e saúde ocupacional de todo mundo.
 * Por isso segue o modelo do VB, não o do Caixa/Case:
 *
 *  - **Admin NÃO passa por cima.** A única porta é a concessão explícita numa
 *    linha de `user_module_roles` (module='dp'). No início: Lucas Meireles e
 *    Marcelo Gonçalves (migration `20260929150000_dp_module.sql`).
 *  - **Nenhum admin consegue se conceder.** A policy de `user_module_roles`
 *    deixa qualquer admin escrever ali pelo PostgREST; para o DP um trigger no
 *    banco recusa INSERT/UPDATE/DELETE de linha `module='dp'` que não venha do
 *    service role (ou de migration). Sem isso, o "admin não passa por cima"
 *    seria só de fachada.
 *  - **Não há botão em Usuários > "Módulos visíveis"**, e o módulo não entra no
 *    catálogo de regras especiais (@/lib/auth/user-exceptions): as duas telas
 *    são vistas por todos os admins, e anunciar lá quem tem o DP já seria
 *    vazar parte do que é sigiloso. Liberar alguém = inserir a linha com o
 *    service role (via migration ou SQL do dono do projeto).
 *
 * Client-safe: só constantes e funções puras.
 */
export const DP_MODULE = "dp";

/** Único papel por enquanto. Papéis finos (ex.: autoatendimento do colaborador) virão depois. */
export const DP_ROLE_GESTOR = "gestor";

/** Rota raiz do módulo. */
export const DP_PATH = "/dp";

/** Chaves dos itens do grupo DP no menu lateral. */
export const DP_NAV_KEY_OVERVIEW = "dp-overview";
export const DP_NAV_KEY_COLABORADORES = "dp-colaboradores";
export const DP_COLABORADORES_PATH = "/dp/colaboradores";
export const DP_NAV_KEY_EMPRESAS = "dp-empresas";
export const DP_EMPRESAS_PATH = "/dp/empresas";

/**
 * Há concessão do módulo? Aceita o select enxuto do middleware e da root page
 * (`{ module, role }`). Papel desconhecido não concede nada — falha fechada,
 * para que uma linha com papel digitado errado não abra um módulo sigiloso.
 */
export function hasDpGrant(
  rows: Array<{ module?: string | null; role?: string | null }> | null | undefined,
): boolean {
  return (rows ?? []).some(
    (row) => row?.module === DP_MODULE && row.role === DP_ROLE_GESTOR,
  );
}

export function isDpPath(pathname: string): boolean {
  return pathname === DP_PATH || pathname.startsWith(`${DP_PATH}/`);
}
