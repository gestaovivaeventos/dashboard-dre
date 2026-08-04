// Quem precisa aprovar o quê, HOJE — fonte dos destinatários do lembrete diário.
//
// ─── Fonte da verdade ────────────────────────────────────────────────────────
// Esta rotina NÃO cria uma regra nova de roteamento: ela repete a decisão que a
// tela de Aprovações (getRequests + applyApprovalStep) já toma.
//
//   1. A ETAPA vem do STATUS, não de heurística:
//        'pendente'          → aguarda GERENTE / GERENTE SÓCIO
//        'pendente_diretor'  → aguarda DIRETOR
//      É o mesmo mapeamento do STATUS_BADGE da tela ("Aguardando Gerente" /
//      "Aguardando Diretor"). Como `applyApprovalStep` só move para
//      'pendente_diretor' DEPOIS que o gerente aprova uma requisição fora do
//      orçamento, o diretor nunca é notificado antes da etapa gerencial —
//      enquanto o gerente não aprovar, o status ainda é 'pendente'.
//
//   2. QUEM É NOTIFICADO é sempre limitado pelo SETOR — inclusive o diretor:
//        - gerente → filtra por user_sectors, como o `hasSectorVisibility` do
//          getRequests (quem não tem nenhum vínculo recebe de todos os setores,
//          mesmo fallback do getRequests e do notifyPendingApproval);
//        - diretor → APROVAR ele pode qualquer setor (`hasGlobalVisibility`), mas
//          RECEBER e-mail só dos setores cadastrados para ele na tela de Usuários
//          (user_sectors). Decisão de negócio: a caixa de entrada do diretor
//          segue a responsabilidade dele, não a alçada técnica. Diretor sem
//          nenhum setor cadastrado não é notificado de nada — e a requisição sem
//          destinatário não some: entra em `orphans` e vira alerta ao admin.
//
//   3. Os OVERRIDES de `routing.ts` valem igual:
//        - solicitante especial  → diretor fixo (APPROVAL_ROUTING.directorOnly)
//        - tipo de despesa       → gerente fixo (APPROVAL_ROUTING.expenseTypeManager)
//        - alçada por e-mail     → approverSectorRestrictionFor (falha fechada:
//          se o servidor bloquearia a aprovação, o usuário também não é avisado)
//        - responsável por setor fora do perfil diretor → DIRECTOR_HIGHLIGHT_SECTORS
//
// ─── Diferenças deliberadas em relação ao notifyPendingApproval ──────────────
//   - ADMIN NÃO RECEBE POR SER ADMIN: a notificação in-app avisa todo admin de
//     tudo; o e-mail é dirigido a quem tem a pendência (Gerente, Gerente Sócio,
//     Diretor). A exceção é o admin que TAMBÉM é diretor de setores específicos,
//     declarado em DIRECTOR_HIGHLIGHT_SECTORS (routing.ts): ele entra na etapa do
//     diretor, restrito aos setores listados ali. Incluir um e-mail naquela lista
//     passa, portanto, a gerar e-mail diário além do destaque na tela.
//   - O pool sai de `users.profile` (modelo novo, autoritativo), não de
//     `user_module_roles`. A tabela legada ainda guarda papéis 'gerente'/'diretor'
//     de usuários que hoje têm outro perfil (ex.: contas_a_pagar) — usá-la
//     mandaria e-mail de aprovação para quem não é aprovador.
//   - O perfil `gerente_setor` ("Gerente") entra junto com `gerente` ("Gerente
//     Sócio"): os dois derivam o mesmo CtrlRole e têm alçada idêntica.

import {
  APPROVAL_ROUTING,
  approverSectorRestrictionFor,
  DIRECTOR_HIGHLIGHT_SECTORS,
  directorHighlightSectorsFor,
  isForcedDirectorRouting,
  normalizeSectorName,
} from "@/lib/ctrl/routing";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ApprovalStage = "gerente" | "diretor";

/** Perfis de `users.profile` que aprovam cada etapa. */
const STAGE_PROFILES: Record<ApprovalStage, string[]> = {
  // "Gerente Sócio" (gerente) e "Gerente" (gerente_setor) têm alçada idêntica.
  gerente: ["gerente", "gerente_setor"],
  diretor: ["diretor"],
};

export interface PendingApprovalRequest {
  id: string;
  requestNumber: number;
  title: string;
  /** Categoria = tipo de despesa (o que é orçado). */
  category: string;
  sectorName: string;
  supplier: string;
  amount: number;
  /** Coluna DATE pura ('YYYY-MM-DD') — formatar com formatDayBR. */
  dueDate: string | null;
  /** TIMESTAMPTZ — formatar com formatDateBR (Brasília). */
  createdAt: string;
  stage: ApprovalStage;
  /** Fora do orçamento (nivel_3) e não apenas roteada por regra ao diretor. */
  outOfBudget: boolean;
  /** Roteada direto ao diretor por regra de negócio (setor Diretoria / solicitante especial). */
  forcedDirector: boolean;
}

export interface ApprovalReminderTarget {
  userId: string;
  name: string;
  email: string;
  /** 'misto' quando o usuário acumula pendências das duas etapas. */
  stage: ApprovalStage | "misto";
  requests: PendingApprovalRequest[];
}

/** Requisição pendente que não achou nenhum aprovador — indica falha de cadastro. */
export interface OrphanPendingRequest {
  id: string;
  requestNumber: number;
  sectorName: string;
  stage: ApprovalStage;
}

export interface ApprovalReminderPlan {
  targets: ApprovalReminderTarget[];
  orphans: OrphanPendingRequest[];
  /** Total de requisições pendentes consideradas (as duas etapas). */
  pendingCount: number;
}

interface ApproverUser {
  id: string;
  name: string | null;
  email: string | null;
  profile: string | null;
  active: boolean | null;
}

/** Join to-one do PostgREST volta objeto ou array conforme a inferência. */
function relatedName(value: unknown): string | null {
  if (!value) return null;
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const name = (row as { name?: unknown }).name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

/**
 * Requisições que, AGORA, aguardam uma decisão de aprovação.
 *
 * Só os dois status de espera entram. `aguardando_complementacao` fica de fora
 * de propósito: a bola está com o solicitante, não com o aprovador. Excluídas
 * (soft delete) também ficam de fora.
 */
async function loadPendingRequests(db: SupabaseClient) {
  const { data, error } = await db
    .from("ctrl_requests")
    .select(
      `id, request_number, title, amount, due_date, created_at, status, approval_tier,
       sector_id, created_by, expense_type_id, favorecido,
       ctrl_sectors(name), ctrl_expense_types(name), ctrl_suppliers(name)`,
    )
    .in("status", ["pendente", "pendente_diretor"])
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Falha ao carregar requisições pendentes: ${error.message}`);
  return (data ?? []) as unknown as Array<Record<string, unknown>>;
}

/** Aprovadores por etapa: perfil autoritativo, ativos e com acesso a Compras. */
async function loadApproverPool(
  db: SupabaseClient,
): Promise<Record<ApprovalStage, ApproverUser[]>> {
  const allProfiles = Array.from(
    new Set([...STAGE_PROFILES.gerente, ...STAGE_PROFILES.diretor]),
  );

  const { data, error } = await db
    .from("users")
    .select("id, name, email, profile, active")
    .eq("active", true)
    .eq("can_compras", true)
    .in("profile", allProfiles);
  if (error) throw new Error(`Falha ao carregar aprovadores: ${error.message}`);

  const users = ((data ?? []) as ApproverUser[]).filter((u) => Boolean(u.email?.trim()));
  const byStage = (stage: ApprovalStage) =>
    users.filter((u) => STAGE_PROFILES[stage].includes(u.profile ?? ""));

  return { gerente: byStage("gerente"), diretor: byStage("diretor") };
}

/**
 * Responsáveis por setor declarados em DIRECTOR_HIGHLIGHT_SECTORS que não têm
 * perfil `diretor` (tipicamente admins). Entram na etapa do diretor restritos
 * aos setores listados para o e-mail deles.
 */
async function loadHighlightDirectors(db: SupabaseClient): Promise<ApproverUser[]> {
  const emails = DIRECTOR_HIGHLIGHT_SECTORS.map((r) => r.email.trim().toLowerCase());
  if (emails.length === 0) return [];
  // ilike: o cadastro pode ter o e-mail com outra caixa que a lista do routing.
  const { data } = await db
    .from("users")
    .select("id, name, email, profile, active")
    .or(emails.map((e) => `email.ilike.${e}`).join(","))
    .eq("active", true);
  return ((data ?? []) as ApproverUser[]).filter((u) => Boolean(u.email?.trim()));
}

/** Vínculos user_sectors — filtram quem é notificado nas DUAS etapas. */
async function loadSectorLinks(
  db: SupabaseClient,
  userIds: string[],
): Promise<Map<string, Set<string>>> {
  const links = new Map<string, Set<string>>();
  if (userIds.length === 0) return links;
  const { data } = await db
    .from("user_sectors")
    .select("user_id, sector_id")
    .in("user_id", userIds);
  for (const row of (data ?? []) as Array<{ user_id: string; sector_id: string }>) {
    if (!links.has(row.user_id)) links.set(row.user_id, new Set());
    links.get(row.user_id)!.add(row.sector_id);
  }
  return links;
}

/**
 * Monta, por usuário, a lista de requisições que dependem especificamente da
 * aprovação dele agora. Usuários sem pendência simplesmente não aparecem no
 * resultado (a rotina não envia e-mail vazio).
 */
export async function buildApprovalReminderPlan(
  db: SupabaseClient,
): Promise<ApprovalReminderPlan> {
  const rows = await loadPendingRequests(db);
  if (rows.length === 0) return { targets: [], orphans: [], pendingCount: 0 };

  const pool = await loadApproverPool(db);
  const allApprovers = new Map<string, ApproverUser>();
  for (const u of [...pool.gerente, ...pool.diretor]) allApprovers.set(u.id, u);

  // Responsáveis por setor fora do perfil diretor (DIRECTOR_HIGHLIGHT_SECTORS):
  // entram na etapa do diretor, restritos aos setores declarados para eles.
  const highlightDirectors = await loadHighlightDirectors(db);
  for (const u of highlightDirectors) {
    if (!allApprovers.has(u.id)) allApprovers.set(u.id, u);
  }
  const directorCandidates = [
    ...pool.diretor,
    ...highlightDirectors.filter((u) => !pool.diretor.some((d) => d.id === u.id)),
  ];

  // Aprovadores fixos das regras de negócio podem estar fora do pool por perfil
  // (o vínculo é por ID, acordado no routing.ts) — carrega-os explicitamente.
  const explicitIds = [
    APPROVAL_ROUTING.directorOnly.directorId,
    APPROVAL_ROUTING.expenseTypeManager.managerId,
  ].filter((id) => !allApprovers.has(id));
  if (explicitIds.length > 0) {
    const { data: explicitRows } = await db
      .from("users")
      .select("id, name, email, profile, active")
      .in("id", explicitIds)
      .eq("active", true);
    for (const u of (explicitRows ?? []) as ApproverUser[]) allApprovers.set(u.id, u);
  }

  const approverIds = Array.from(allApprovers.keys());
  const sectorLinks = await loadSectorLinks(db, approverIds);

  // Alçada e destaque por e-mail (casados por NOME de setor).
  const restrictions = new Map<string, Set<string> | null>();
  const highlights = new Map<string, Set<string> | null>();
  for (const u of Array.from(allApprovers.values())) {
    restrictions.set(u.id, approverSectorRestrictionFor({ email: u.email }));
    highlights.set(u.id, directorHighlightSectorsFor({ email: u.email }));
  }

  const byUser = new Map<string, ApprovalReminderTarget>();
  const orphans: OrphanPendingRequest[] = [];

  for (const row of rows) {
    const status = row.status as string;
    const stage: ApprovalStage = status === "pendente_diretor" ? "diretor" : "gerente";
    const sectorId = row.sector_id as string;
    const sectorName = relatedName(row.ctrl_sectors) ?? "Setor nao informado";
    const createdBy = (row.created_by as string) ?? null;
    const expenseTypeId = (row.expense_type_id as string) ?? null;

    // 1) Aprovador fixo por regra de negócio (mesma decisão do createRequest e
    //    do notifyDirectorStage). Quando existe, ele é o único destinatário.
    let candidateIds: string[];
    if (stage === "diretor" && createdBy === APPROVAL_ROUTING.directorOnly.requesterId) {
      candidateIds = [APPROVAL_ROUTING.directorOnly.directorId];
    } else if (
      stage === "gerente" &&
      expenseTypeId === APPROVAL_ROUTING.expenseTypeManager.expenseTypeId
    ) {
      candidateIds = [APPROVAL_ROUTING.expenseTypeManager.managerId];
    } else if (stage === "diretor") {
      // Diretor aprova qualquer setor, mas só é NOTIFICADO dos setores dele.
      // Quem tem override por e-mail (admin responsável por setores específicos)
      // casa por NOME; os demais, pelos vínculos de user_sectors. Sem setor
      // cadastrado não há notificação — a requisição vira `orphan`.
      candidateIds = directorCandidates
        .filter((u) => {
          const overrideNames = highlights.get(u.id) ?? null;
          if (overrideNames) return overrideNames.has(normalizeSectorName(sectorName));
          return sectorLinks.get(u.id)?.has(sectorId) ?? false;
        })
        .map((u) => u.id);
    } else {
      // Gerente: filtrado pelo setor da requisição (sem vínculo => recebe tudo,
      // mesmo fallback do getRequests e do notifyPendingApproval).
      candidateIds = pool.gerente
        .filter((u) => {
          const links = sectorLinks.get(u.id);
          if (!links || links.size === 0) return true;
          return links.has(sectorId);
        })
        .map((u) => u.id);
    }

    const forcedDirector = isForcedDirectorRouting({
      sector_id: sectorId,
      created_by: createdBy,
    });

    const request: PendingApprovalRequest = {
      id: row.id as string,
      requestNumber: Number(row.request_number ?? 0),
      title: (row.title as string) ?? "Requisição",
      category: relatedName(row.ctrl_expense_types) ?? "Não informada",
      sectorName,
      supplier:
        relatedName(row.ctrl_suppliers) ??
        ((row.favorecido as string)?.trim() || "Não informado"),
      amount: Number(row.amount ?? 0),
      dueDate: (row.due_date as string) ?? null,
      createdAt: (row.created_at as string) ?? "",
      stage,
      outOfBudget: (row.approval_tier as string) === "nivel_3" && !forcedDirector,
      forcedDirector,
    };

    let assigned = 0;
    for (const userId of candidateIds) {
      const user = allApprovers.get(userId);
      if (!user || !user.email?.trim() || user.active === false) continue;

      // 2) Alçada: se o usuário não poderia aprovar este setor, não é notificado.
      const allowedSectors = restrictions.get(userId) ?? null;
      if (allowedSectors && !allowedSectors.has(normalizeSectorName(sectorName))) continue;

      assigned += 1;

      const existing = byUser.get(userId);
      if (existing) {
        if (existing.requests.some((r) => r.id === request.id)) continue;
        existing.requests.push(request);
        if (existing.stage !== "misto" && existing.stage !== stage) existing.stage = "misto";
      } else {
        byUser.set(userId, {
          userId,
          name: user.name?.trim() || user.email.trim(),
          email: user.email.trim().toLowerCase(),
          stage,
          requests: [request],
        });
      }
    }

    // Nenhum aprovador elegível: não há a quem avisar. Vira alerta operacional
    // (setor sem gerente vinculado, alçada restrita demais, cadastro inativo…)
    // em vez de sumir silenciosamente.
    if (assigned === 0) {
      orphans.push({
        id: request.id,
        requestNumber: request.requestNumber,
        sectorName,
        stage,
      });
    }
  }

  // Dentro do e-mail: o que está parado há mais tempo aparece primeiro.
  for (const target of Array.from(byUser.values())) {
    target.requests.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  return {
    targets: Array.from(byUser.values()).sort((a, b) => a.email.localeCompare(b.email)),
    orphans,
    pendingCount: rows.length,
  };
}
