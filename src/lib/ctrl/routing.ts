// Regras de roteamento de aprovação (overrides de negócio).
//
// Estes IDs são acordos de negócio explícitos, não dados derivados — por isso
// ficam fixos no código. Mudaram? Atualize aqui.
//
// ⚠️ AO ADICIONAR/ALTERAR UMA REGRA NOMINAL AQUI, ATUALIZE TAMBÉM
//    `src/lib/auth/user-exceptions.ts` — é o catálogo que alimenta o botão
//    "Regras especiais" da tela de Usuários. Instrução permanente do Marcelo:
//    o admin precisa conseguir consultar TODAS as exceções por lá. Regra que
//    não está no catálogo volta a ser invisível pra quem administra usuários.
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
    // ⚠️ COBERTURA DE FÉRIAS (desde 21/09/2026): temporariamente com o Vitor
    // (Diretor), enquanto o Régis está de férias. ORIGINAL (Régis Adriano Da
    // Costa): "bcacac55-230e-447c-bb7c-c0ff63ce18ee". Para reverter no retorno do
    // Régis, restaure o ID original e esvazie APPROVAL_COVERAGE (ver abaixo e
    // docs/ferias-regis-vitor.md).
    managerId: "f159c959-55c2-4cc9-a1e4-acc4b2ab69c3", // Vitor de Oliveira Pedrosa (cobertura de férias)
  },
  // Setor cujas requisições vão sempre direto ao diretor, mesmo com orçamento
  // aprovado (pula o gerente). Notifica todos os diretores.
  directorSector: {
    sectorId: "306ef9b3-7895-446d-b9d3-5537942627b2", // Diretoria
  },
} as const;

// ─── Setores em que o GERENTE conclui mesmo fora do orçamento ─────────────────
//
// O oposto do `directorSector`: aqui a etapa do diretor é DISPENSADA. Caso de
// uso: setor recém-criado, ainda sem orçamento carregado — toda requisição sai
// "fora do orçamento" (nivel_3) e iria ao diretor, gerando uma fila de
// aprovações de diretoria só por falta de cadastro de orçamento.
//
// O que NÃO muda para esses setores: `approval_tier` continua nivel_3 (é fato
// que está fora do orçamento), o prefixo "NÃO ORÇADO" e a justificativa
// obrigatória continuam, o badge "Fora do orçamento" continua. Só a etapa do
// diretor é pulada: a aprovação do gerente já finaliza.
//
// A aprovação do gerente continua OBRIGATÓRIA (clique manual): a auto-aprovação
// gerencial de `createRequest` exige despesa prevista em orçamento (nivel_2 +
// isBudgeted), e setor sem orçamento nunca cai nela — toda requisição nasce
// Pendente. Decisão do Lucas em 16/09/2026: "auto aprovação não precisa existir
// no caso da Boreal; pode deixar sendo necessária a aprovação". Não crie
// auto-aprovação para estes setores.
//
// Governança: sem a etapa do diretor, um gerente que também solicita nesse
// setor aprova a própria requisição sem segundo par de olhos (o clique manual
// em Aprovar não tem trava de "própria requisição"). Aceito para o Boreal por
// ser um projeto em avaliação.
//
// PRAZO: a regra existe porque o setor não tem orçamento. Quando houver
// orçamento (previsto para 2027), a etapa do diretor volta — para isso basta
// REMOVER a entrada abaixo. `reviewBy` é lembrete, não expiração: a regra não
// desliga sozinha, porque desligar sem ninguém saber é pior do que esquecer.
//
// Identificado por ID (estável a renomeação), com o nome em comentário.
export const MANAGER_FINAL_SECTORS: ReadonlyArray<{
  sectorId: string;
  /** Só para leitura humana — a comparação é pelo ID. */
  sectorName: string;
  since: string;
  /** Data em que a regra deve ser reavaliada (aparece no catálogo de exceções). */
  reviewBy: string;
  /** Motivo, em uma linha, para o catálogo. */
  reason: string;
}> = [
  {
    sectorId: "e5ce6368-94fe-40ad-8bd5-a1a4e7deab7d",
    sectorName: "Boreal",
    since: "2026-09-16",
    reviewBy: "2027-01-01",
    reason:
      "Projeto em avaliação, ainda sem orçamento. A aprovação do diretor volta quando o " +
      "orçamento do setor for carregado (previsto para 2027).",
  },
  {
    // Setor "Bem Laranja" (antes "Associação Bem Laranja" — o ID não muda com o
    // nome). Gerente aprovador: Regis, por APPROVER_SECTOR_RESTRICTIONS; quem
    // solicita são outras pessoas, então aqui não há o caso de aprovar a própria.
    sectorId: "444e3b49-b040-4ff8-87c5-53c73a551237",
    sectorName: "Bem Laranja",
    since: "2026-09-16",
    reviewBy: "2027-01-01",
    reason:
      "Setor sem orçamento cadastrado — toda requisição saía \"fora do orçamento\" e ia ao " +
      "diretor. A aprovação do diretor volta quando o orçamento do setor for carregado.",
  },
];

/**
 * True quando as requisições do setor são concluídas pelo GERENTE mesmo fora do
 * orçamento — a etapa do diretor não existe para ele. Vale tanto para requisição
 * de um setor quanto para a linha daquele setor num rateio.
 */
export function isManagerFinalSector(sectorId: string | null | undefined): boolean {
  if (!sectorId) return false;
  return MANAGER_FINAL_SECTORS.some((rule) => rule.sectorId === sectorId);
}

// ─── Setores ISENTOS de controle de orçamento ─────────────────────────────────
//
// Setores cujas despesas são RESSARCIDAS e NÃO compõem o resultado da empresa —
// por isso nunca foram orçadas. Sem esta regra, toda requisição deles cairia como
// "fora do orçamento" (nivel_3): prefixo NÃO ORÇADO, justificativa obrigatória e
// roteamento ao diretor. Aqui o confronto com o orçamento é DISPENSADO: a
// requisição é tratada como nivel_2 e segue só com a aprovação do gerente do
// setor (manual, sem auto-aprovação — is_budgeted continua false).
//
// Diferente de MANAGER_FINAL_SECTORS (que só dispensa o diretor, mantendo o
// nivel_3, o prefixo e a justificativa): aqui a despesa não é "fora do orçamento",
// é FORA DO CONTROLE de orçamento, por natureza.
//
// Identificado por ID (estável a renomeação), com o nome em comentário. Qualquer
// linha de ctrl_budget que porventura exista para esses setores passa a ser
// IGNORADA no fluxo de aprovação (decisão consciente — o setor não tem controle).
export const BUDGET_EXEMPT_SECTORS: ReadonlyArray<{
  sectorId: string;
  /** Só para leitura humana — a comparação é pelo ID. */
  sectorName: string;
  since: string;
  reason: string;
}> = [
  {
    sectorId: "521074f1-cb92-4ef9-a40a-a0e45c1711c6",
    sectorName: "CSC",
    since: "2026-09-21",
    reason: "Despesas ressarcidas — não compõem o resultado da empresa; nunca orçadas.",
  },
  {
    sectorId: "eb14752a-f384-4978-ac0c-d6c3c6fb430b",
    sectorName: "CSC Consultoria",
    since: "2026-09-21",
    reason: "Despesas ressarcidas — não compõem o resultado da empresa; nunca orçadas.",
  },
  {
    sectorId: "a0e587ff-1ecc-42f6-9f7e-4bdec7312093",
    sectorName: "CSC Gestão",
    since: "2026-09-21",
    reason: "Despesas ressarcidas — não compõem o resultado da empresa; nunca orçadas.",
  },
  {
    sectorId: "5769358c-b068-4bb4-8a7b-0e749ed13ec1",
    sectorName: "CSC Pós-Vendas",
    since: "2026-09-21",
    reason: "Despesas ressarcidas — não compõem o resultado da empresa; nunca orçadas.",
  },
];

/**
 * True quando o setor é ISENTO de controle de orçamento (despesas ressarcidas).
 * Requisições dele não são confrontadas com orçamento e seguem só com a aprovação
 * do gerente. Vale para requisição de 1 setor e para a linha do setor num rateio.
 */
export function isBudgetExemptSector(sectorId: string | null | undefined): boolean {
  if (!sectorId) return false;
  return BUDGET_EXEMPT_SECTORS.some((rule) => rule.sectorId === sectorId);
}

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
    //
    // O setor chama-se "Bem Laranja" na base; a regra nasceu com
    // "Associação Bem Laranja", que não casava com nada — o casamento é por nome
    // exato (normalizado só para acento/caixa), então a alçada desse setor ficava
    // órfã em silêncio: ele não via nem aprovava as requisições dele. Os dois nomes
    // ficam listados para a regra sobreviver a uma renomeação em qualquer direção —
    // nome que não existe não resolve setor nenhum e é inofensivo.
    email: "regis@vivaeventos.com.br",
    allowedSectorNames: [
      "Gestão de Pessoas",
      "Associação Bem Laranja",
      "Bem Laranja",
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
//
// ATENÇÃO — esta lista tem DOIS efeitos hoje: além do destaque na tela, ela
// coloca o usuário na etapa do DIRETOR do lembrete diário por e-mail
// (src/lib/ctrl/approval-reminders/), restrito aos setores listados aqui. Ou
// seja, incluir um e-mail nesta lista passa a gerar e-mail diário para ele.
export const DIRECTOR_HIGHLIGHT_SECTORS: ReadonlyArray<{
  email: string;
  sectorNames: readonly string[];
}> = [
  {
    // Marcelo Gonçalves — admin (todas as permissões) e diretor responsável pela
    // aprovação destes setores. Destaca-os na tela de Aprovações e o coloca na
    // etapa do diretor do lembrete diário. "Diretoria" entrou em 10/08/2026: o
    // setor já era roteado direto ao diretor (APPROVAL_ROUTING.directorSector),
    // mas sem ninguém vinculado a ele o e-mail não tinha destinatário.
    email: "marcelo@quokka.net.br",
    sectorNames: ["TI", "Financeiro Cash Out", "Financeiro CSC", "Diretoria"],
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

// ─── Cobertura temporária de aprovações (férias / ausências) ──────────────────
//
// Enquanto um aprovador está fora, outro ASSUME os fluxos dele sem que nenhum
// perfil mude no banco. Cada entrada é um acordo TEMPORÁRIO e deve ser REMOVIDA
// no retorno da pessoa — não expira sozinha (`until` é lembrete, não expiração:
// desligar sem ninguém saber é pior do que esquecer).
//
// Efeito hoje: o `coveringEmail` passa a RECEBER o lembrete diário da etapa de
// GERENTE dos setores listados, mesmo que o perfil dele não seja gerente (ex.:
// um diretor cobrindo um gerente). NÃO altera alçada: quem cobre aprova pelo
// próprio perfil — um diretor já pode aprovar qualquer setor e já vê tudo na
// tela; a cobertura só garante que ele seja NOTIFICADO. O roteamento fixo por
// tipo de despesa (expenseTypeManager) é coberto à parte, trocando o managerId.
//
// ⚠️ Ao adicionar/remover uma entrada, atualize o catálogo em
//    src/lib/auth/user-exceptions.ts ("Regras especiais" da tela de Usuários) e
//    o registro em docs/ferias-regis-vitor.md.
export const APPROVAL_COVERAGE: ReadonlyArray<{
  /** Quem está COBRINDO (assume os fluxos). */
  coveringEmail: string;
  /** Quem está AUSENTE (dono original dos fluxos). */
  coveredEmail: string;
  /** Setores (por NOME) cuja etapa de GERENTE o coveringEmail passa a receber no lembrete diário. */
  managerSectorNames: readonly string[];
  since: string;
  /** Retorno previsto — lembrete, não expiração automática. */
  until: string;
  reason: string;
}> = [
  {
    coveringEmail: "vitor@vivaeventos.com.br",
    coveredEmail: "regis@vivaeventos.com.br",
    managerSectorNames: [
      "Gestão de Pessoas",
      "Bem Laranja",
      "Eventos Oficiais",
      "Despesas Gerais",
    ],
    since: "2026-09-21",
    until: "2026-10-05",
    reason:
      "Férias do Régis — Vitor (Diretor) assume as aprovações: recebe os lembretes " +
      "diários da etapa de gerente destes setores; o roteamento do tipo Capacitações e " +
      "Treinamentos foi passado ao Vitor em APPROVAL_ROUTING.expenseTypeManager.",
  },
];

/**
 * Setores (normalizados) cuja etapa de GERENTE este e-mail está COBRINDO no
 * lembrete diário. `null` quando o usuário não cobre ninguém.
 */
export function managerCoverageSectorsFor(user: {
  email?: string | null;
}): Set<string> | null {
  const email = user.email?.trim().toLowerCase();
  if (!email) return null;
  const names = APPROVAL_COVERAGE.filter(
    (c) => c.coveringEmail.trim().toLowerCase() === email,
  ).flatMap((c) => c.managerSectorNames);
  if (names.length === 0) return null;
  return new Set(names.map(normalizeSectorName));
}
