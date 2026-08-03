// Regras de roteamento de aprovação (overrides de negócio).
//
// Estes IDs são acordos de negócio explícitos, não dados derivados — por isso
// ficam fixos no código. Mudaram? Atualize aqui.
//
// Vive num módulo próprio (sem "use server") para ser compartilhado entre a
// server action (createRequest) e a UI (badges de aprovação): ambos precisam
// concordar sobre "quem vai direto ao diretor". Antes, o createRequest embutia
// esse roteamento no `approval_tier` (marcando nível 3), o que fazia a tela
// rotular como "Fora do orçamento" requisições que estavam dentro do orçamento.

export const APPROVAL_ROUTING = {
  // Requisições deste solicitante pulam o gerente e nascem aguardando o diretor.
  directorOnly: {
    requesterId: "45a367ad-695e-4758-b033-470483758b4c",
    directorId: "f159c959-55c2-4cc9-a1e4-acc4b2ab69c3",
  },
  // Tipo de despesa cuja etapa de gerente é direcionada a este gerente.
  expenseTypeManager: {
    expenseTypeId: "7233530b-fb16-441d-a22c-9611ddedf1ab", // Capacitações e Treinamentos
    managerId: "bcacac55-230e-447c-bb7c-c0ff63ce18ee",
  },
  // Setor cujas requisições vão sempre direto ao diretor, mesmo com orçamento
  // aprovado (pula o gerente). Notifica todos os diretores.
  directorSector: {
    sectorId: "306ef9b3-7895-446d-b9d3-5537942627b2", // Diretoria
  },
} as const;

/**
 * Uma requisição é roteada direto ao diretor (pulando o gerente) por REGRA —
 * setor Diretoria ou solicitante especial —, independente do orçamento. Isso é
 * diferente de estar "fora do orçamento" (que é o `approval_tier === 'nivel_3'`
 * vindo do cálculo de saldo).
 */
export function isForcedDirectorRouting(input: {
  sector_id?: string | null;
  created_by?: string | null;
}): boolean {
  return (
    input.sector_id === APPROVAL_ROUTING.directorSector.sectorId ||
    input.created_by === APPROVAL_ROUTING.directorOnly.requesterId
  );
}

// ─── Restrição de setores de APROVAÇÃO ────────────────────────────────────────
//
// A tabela user_sectors controla DOIS papéis ao mesmo tempo: os setores em que o
// usuário pode CRIAR requisições e, para gerentes, os setores que ele pode
// VER/APROVAR. Alguns gerentes precisam solicitar em vários setores (logo, estão
// vinculados a todos), mas só têm alçada para aprovar um subconjunto.
//
// Este override separa a alçada de aprovação sem mexer nos vínculos: o usuário
// segue com todos os setores para criar requisições, mas na tela de Aprovações
// (e nas ações de aprovação no servidor) só enxerga/age nos setores listados
// aqui. Identificamos por e-mail (chave natural estável); os setores são casados
// por NOME (ctrl_sectors.name é único), de forma resiliente a acento/caixa.
export const APPROVER_SECTOR_RESTRICTIONS: ReadonlyArray<{
  email: string;
  allowedSectorNames: readonly string[];
}> = [
  {
    // Regis Adriano Da Costa — solicita em todos os setores, mas como gerente só
    // aprova estes quatro. "Despesas Gerais" entrou em 03/08/2026.
    email: "regis@vivaeventos.com.br",
    allowedSectorNames: [
      "Gestão de Pessoas",
      "Associação Bem Laranja",
      "Eventos Oficiais",
      "Despesas Gerais",
    ],
  },
];

// ─── Destaque "Do seu setor" para responsáveis fora do perfil diretor ─────────
//
// A separação visual "Do seu setor" x "Demais setores" na tela de Aprovações é
// alimentada pelos setores vinculados ao usuário (user_sectors) e só liga para o
// perfil `diretor`. Alguns responsáveis por aprovar setores específicos têm
// perfil `admin` (precisam de todas as permissões do sistema) — como admin, veem
// tudo numa lista única, sem o destaque.
//
// Este override marca, por e-mail, os setores que tais usuários dirigem, ligando
// o mesmo destaque visual sem alterar seu perfil nem sua visibilidade (seguem
// vendo TODAS as requisições). Setores casados por NOME (ctrl_sectors.name é
// único), resiliente a acento/caixa, como no restante deste módulo.
export const DIRECTOR_HIGHLIGHT_SECTORS: ReadonlyArray<{
  email: string;
  sectorNames: readonly string[];
}> = [
  {
    // Marcelo Gonçalves — admin (todas as permissões) e diretor responsável pela
    // aprovação destes três setores. Destaca-os na tela de Aprovações.
    email: "marcelo@quokka.net.br",
    sectorNames: ["TI", "Financeiro Cash Out", "Financeiro CSC"],
  },
];

/**
 * Conjunto (normalizado) de nomes de setor que o usuário DIRIGE para fins de
 * destaque na tela de Aprovações, quando há um override configurado para ele.
 * Retorna `null` quando não há override — nesse caso o destaque segue os vínculos
 * normais (user_sectors) e só se aplica ao perfil diretor.
 */
export function directorHighlightSectorsFor(user: {
  email?: string | null;
}): Set<string> | null {
  const email = user.email?.trim().toLowerCase();
  if (!email) return null;
  const rule = DIRECTOR_HIGHLIGHT_SECTORS.find(
    (r) => r.email.trim().toLowerCase() === email,
  );
  if (!rule) return null;
  return new Set(rule.sectorNames.map(normalizeSectorName));
}

// Faixa Unicode de marcas diacríticas combinantes (U+0300–U+036F), construída
// em runtime para manter o source ASCII e dispensar a flag /u do regex.
const COMBINING_DIACRITICS = new RegExp(
  "[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]",
  "g",
);

/** Normaliza um nome de setor para comparação resiliente (sem acento/caixa/espaços). */
export function normalizeSectorName(name: string): string {
  return name
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS, "")
    .trim()
    .toLowerCase();
}

/**
 * Conjunto (normalizado) de nomes de setor que o usuário PODE aprovar, quando há
 * uma restrição de alçada configurada para ele. Retorna `null` quando o usuário
 * não tem restrição — nesse caso a alçada segue os vínculos normais.
 */
export function approverSectorRestrictionFor(user: {
  email?: string | null;
}): Set<string> | null {
  const email = user.email?.trim().toLowerCase();
  if (!email) return null;
  const rule = APPROVER_SECTOR_RESTRICTIONS.find(
    (r) => r.email.trim().toLowerCase() === email,
  );
  if (!rule) return null;
  return new Set(rule.allowedSectorNames.map(normalizeSectorName));
}
