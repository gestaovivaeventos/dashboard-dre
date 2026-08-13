import { pendingApprovalsForUser } from "@/lib/ctrl/approval-reminders/recipients";
import { currentYearBR } from "@/lib/ctrl/datetime";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CtrlRole } from "@/lib/supabase/types";

export const fmtBRL = new Intl.NumberFormat("pt-BR", {
  style: "decimal",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Quais itens a faixa "Precisa da sua atenção" pode exibir para este usuário.
 *
 * A faixa é uma lista de responsabilidades, não um resumo do sistema: cada
 * alerta só aparece para quem é o dono da pendência. É por isso que ela é uma
 * lista explícita por perfil e não um efeito colateral de qual widget carregou
 * dados — Contas a Pagar, por exemplo, VÊ o quadro "Aprovações pendentes"
 * (acompanha o fluxo) mas não é avisado de aprovação, porque não aprova.
 */
export interface HomeAttentionAlerts {
  /** Requisições aguardando a aprovação DESTE usuário. */
  approvals: boolean;
  /** Falhas no envio ao Omie. */
  omieErrors: boolean;
  /** Fornecedor pendente de homologação / requisição travada por isso. */
  suppliers: boolean;
  /** Requisições próprias aguardando complementação (a bola está com ele). */
  ownComplement: boolean;
  /** Requisições próprias rejeitadas. */
  ownRejected: boolean;
}

// Capacidades derivadas dos papéis CTRL do usuário.
export interface HomeCtrlCaps {
  canApprove: boolean; // vê widget de aprovações
  canPay: boolean; // vê fila de pagamento
  canRequest: boolean; // vê "minhas requisições"
  canBudget: boolean; // vê orçamento do setor
  canHomologate: boolean; // vê fornecedores a homologar
  /**
   * Aprovações sem recorte de etapa/setor (admin e Contas a Pagar, que têm
   * visão global do módulo). Os demais aprovadores veem só o que depende
   * deles — ver loadApprovals.
   */
  approvalsGlobal: boolean;
  /**
   * Orçamento de TODOS os setores (admin). Os aprovadores veem só os setores em
   * que estão cadastrados.
   */
  budgetAllSectors: boolean;
  alerts: HomeAttentionAlerts;
}

export function deriveCtrlCaps(roles: CtrlRole[], sectorIds: string[]): HomeCtrlCaps {
  // Os papéis são inequívocos quanto ao perfil de origem (ver deriveCtrlRoles):
  // admin → ["admin"]; Contas a Pagar → ["contas_a_pagar", "csc",
  // "aprovacao_fornecedor"]; Gerente Sócio e Gerente → ["gerente"]; Diretor →
  // ["diretor"]; Solicitante → ["solicitante"]. Os perfis franqueado / CSC /
  // validador de contrato não têm papel no módulo Compras — chegam aqui com a
  // lista vazia e ficam sem nenhum quadro operacional, só com a parte econômica
  // da tela.
  const isAdmin = roles.includes("admin");
  const isContasAPagar = roles.includes("contas_a_pagar");
  const isApprover = roles.includes("gerente") || roles.includes("diretor");
  const isRequester = roles.includes("solicitante");

  // Admin enxerga a home COMPLETA: todas as seções que existem para os demais
  // perfis, cada uma no seu alcance máximo (aprovações de qualquer etapa/setor,
  // orçamento de todos os setores, fila de pagamento, homologação). É
  // acompanhamento geral do sistema — o que é responsabilidade dele mesmo, os
  // Alertas do Sistema, aparece em destaque no topo da tela (ver HomeView).
  return {
    canApprove: isAdmin || isContasAPagar || isApprover,
    canPay: isAdmin || isContasAPagar,
    // Contas a Pagar saiu daqui: o perfil opera requisições de terceiros (fila
    // de pagamento e homologação), não cria as próprias. O papel legado "csc"
    // que ele acumula é que o trazia para este quadro.
    canRequest: isAdmin || isApprover || isRequester,
    canBudget: isAdmin || (isApprover && sectorIds.length > 0),
    canHomologate: isAdmin || isContasAPagar,
    approvalsGlobal: isAdmin || isContasAPagar,
    budgetAllSectors: isAdmin,
    alerts: {
      approvals: isAdmin || isApprover,
      // Falha no envio ao Omie é operação do Contas a Pagar — é ele quem
      // reenvia. O admin recebe por acompanhar o sistema inteiro.
      omieErrors: isAdmin || isContasAPagar,
      suppliers: isAdmin || isContasAPagar,
      ownComplement: isAdmin || isRequester,
      ownRejected: isAdmin,
    },
  };
}

export interface HomeApprovalItem {
  id: string;
  requestNumber: number;
  title: string;
  amount: number;
  status: string;
  supplierName: string | null;
}
export interface HomeApprovals {
  items: HomeApprovalItem[];
  total: number;
}
export interface HomePayments {
  toSend: number;
  dueThisWeek: number;
  omieErrors: number;
}
export interface HomeMyRequests {
  pendentes: number;
  infoPendente: number;
  /**
   * Subconjunto de `infoPendente`: só `aguardando_complementacao`, ou seja, o
   * gerente/diretor questionou algo e espera resposta do solicitante. É o que
   * alimenta o alerta da faixa — `info_pagamento_pendente` é etapa do Contas a
   * Pagar e continua contando apenas no quadro.
   */
  aguardandoComplementacao: number;
  aprovadas: number;
  rejeitadas: number;
  total: number;
}
export interface HomeBudgetSector {
  sectorId: string;
  sectorName: string;
  orcadoAnual: number;
  consumido: number;
}

/** Fornecedor recém-cadastrado que ainda não passou pela homologação. */
export interface HomeNewSupplier {
  id: string;
  name: string;
  createdAt: string;
}
/** Requisição em aberto cujo fornecedor não está homologado (vai travar no pagamento). */
export interface HomeBlockedRequest {
  id: string;
  requestNumber: number;
  title: string;
  amount: number;
  status: string;
  supplierName: string;
  supplierStatus: string;
}
export interface HomeSuppliers {
  novos: HomeNewSupplier[];
  novosTotal: number;
  bloqueadas: HomeBlockedRequest[];
  bloqueadasTotal: number;
}

export interface HomeBudget {
  sectors: HomeBudgetSector[];
  /**
   * Setores que existem mas não couberam na lista (só acontece na visão de
   * todos os setores, do admin). Vai à tela para o quadro não passar por
   * completo quando não é — a lista integral fica em /ctrl/orcamento.
   */
  hidden: number;
}

export interface HomeCtrlData {
  approvals: HomeApprovals | null;
  payments: HomePayments | null;
  myRequests: HomeMyRequests | null;
  budget: HomeBudget | null;
  suppliers: HomeSuppliers | null;
}

// Resolve join de fornecedor (objeto ou array) → nome.
function supplierName(raw: unknown): string | null {
  if (!raw) return null;
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (v as { name?: string } | null)?.name ?? null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function inDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Aprovações pendentes do usuário.
 *
 * Dois caminhos, e nenhum deles inventa regra de aprovação:
 *
 *  - Visão global (admin e Contas a Pagar): lista todas as requisições nos dois
 *    status de espera, como sempre. É o mesmo alcance que essas pessoas já têm
 *    na tela de Aprovações (`hasGlobalVisibility` do getRequests).
 *  - Aprovador com escopo (Gerente Sócio, Gerente e Diretor): recebe apenas o
 *    que depende DELE agora, via `pendingApprovalsForUser` — a etapa sai do
 *    status ('pendente' → gerente, 'pendente_diretor' → diretor), o setor sai
 *    dos vínculos em user_sectors e os overrides nominais de routing.ts valem
 *    igual. Antes a home consultava tudo sem filtro, então o gerente via na
 *    tela inicial um número maior do que a lista que ele conseguia abrir.
 */
async function loadApprovals(
  userId: string,
  approvalsGlobal: boolean,
): Promise<HomeApprovals | null> {
  if (!approvalsGlobal) return loadScopedApprovals(userId);
  try {
    const db = createAdminClient();
    const statuses = ["pendente", "pendente_diretor"];

    const [{ data: items }, { count }] = await Promise.all([
      db
        .from("ctrl_requests")
        .select("id, request_number, title, amount, status, ctrl_suppliers(name)")
        .in("status", statuses)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(5),
      db
        .from("ctrl_requests")
        .select("id", { count: "exact", head: true })
        .in("status", statuses)
        .is("deleted_at", null),
    ]);

    return {
      items: (items ?? []).map((r) => ({
        id: r.id as string,
        requestNumber: r.request_number as number,
        title: r.title as string,
        amount: Number(r.amount),
        status: r.status as string,
        supplierName: supplierName(r.ctrl_suppliers),
      })),
      total: count ?? 0,
    };
  } catch {
    return null;
  }
}

/** Fatia do plano de aprovações que pertence a este usuário (etapa + setor). */
async function loadScopedApprovals(userId: string): Promise<HomeApprovals | null> {
  try {
    const db = createAdminClient();
    const pending = await pendingApprovalsForUser(db, userId);
    return {
      items: pending.slice(0, 5).map((r) => ({
        id: r.id,
        requestNumber: r.requestNumber,
        title: r.title,
        amount: r.amount,
        status: r.stage === "diretor" ? "pendente_diretor" : "pendente",
        supplierName: r.supplier,
      })),
      total: pending.length,
    };
  } catch {
    return null;
  }
}

async function loadPayments(): Promise<HomePayments | null> {
  try {
    const db = createAdminClient();
    const [{ count: toSend }, { count: dueThisWeek }, { count: omieErrors }] =
      await Promise.all([
        db
          .from("ctrl_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "aprovado")
          .is("deleted_at", null),
        db
          .from("ctrl_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "aprovado")
          .is("deleted_at", null)
          .gte("due_date", todayIso())
          .lte("due_date", inDaysIso(7)),
        db
          .from("ctrl_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "agendado")
          .eq("omie_launch_status", "erro")
          .is("deleted_at", null),
      ]);
    return {
      toSend: toSend ?? 0,
      dueThisWeek: dueThisWeek ?? 0,
      omieErrors: omieErrors ?? 0,
    };
  } catch {
    return null;
  }
}

async function loadMyRequests(userId: string): Promise<HomeMyRequests | null> {
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("ctrl_requests")
      .select("status")
      .eq("created_by", userId)
      .is("deleted_at", null);
    const rows = data ?? [];
    const count = (...s: string[]) =>
      rows.filter((r) => s.includes(r.status as string)).length;
    return {
      pendentes: count("pendente", "pendente_diretor"),
      infoPendente: count("aguardando_complementacao", "info_pagamento_pendente"),
      aguardandoComplementacao: count("aguardando_complementacao"),
      aprovadas: count("aprovado", "agendado"),
      rejeitadas: count("rejeitado"),
      total: rows.length,
    };
  } catch {
    return null;
  }
}

/**
 * Orçado x consumido no ano corrente.
 *
 * `allSectors` (admin) tira o recorte por vínculo e traz todos os setores —
 * a mesma leitura do quadro, sem mudar nada no cálculo. Como a lista pode ficar
 * longa, mostra os setores mais consumidos e devolve quantos ficaram de fora.
 */
const BUDGET_SECTORS_LIMIT = 6;

async function loadBudget(
  sectorIds: string[],
  allSectors: boolean,
): Promise<HomeBudget | null> {
  try {
    const db = createAdminClient();
    const year = currentYearBR();

    // No modo admin as três consultas ficam abertas; nos demais, recortadas
    // pelos setores em que o usuário está cadastrado. O cálculo é o mesmo.
    let budgetQuery = db
      .from("ctrl_budget")
      .select("sector_id, amount")
      .eq("period_year", year);
    let reqsQuery = db
      .from("ctrl_requests")
      .select("sector_id, amount")
      .eq("reference_year", year)
      .in("status", ["aprovado", "agendado", "info_pagamento_pendente"])
      .is("deleted_at", null);
    let sectorsQuery = db.from("ctrl_sectors").select("id, name");
    if (!allSectors) {
      budgetQuery = budgetQuery.in("sector_id", sectorIds);
      reqsQuery = reqsQuery.in("sector_id", sectorIds);
      sectorsQuery = sectorsQuery.in("id", sectorIds);
    }

    const [{ data: budgets }, { data: reqs }, { data: sectors }] = await Promise.all([
      budgetQuery,
      reqsQuery,
      sectorsQuery,
    ]);

    const orcado = new Map<string, number>();
    for (const b of budgets ?? [])
      orcado.set(b.sector_id as string, (orcado.get(b.sector_id as string) ?? 0) + Number(b.amount));
    const consumido = new Map<string, number>();
    for (const r of reqs ?? [])
      consumido.set(
        r.sector_id as string,
        (consumido.get(r.sector_id as string) ?? 0) + Number(r.amount),
      );

    const rows: HomeBudgetSector[] = (sectors ?? []).map((s) => ({
      sectorId: s.id as string,
      sectorName: s.name as string,
      orcadoAnual: orcado.get(s.id as string) ?? 0,
      consumido: consumido.get(s.id as string) ?? 0,
    }));

    if (!allSectors) return { sectors: rows, hidden: 0 };

    // Visão de todos os setores: prioriza quem mais consumiu e diz quantos
    // ficaram de fora, em vez de cortar em silêncio.
    const ordered = rows.sort((a, b) => b.consumido - a.consumido);
    return {
      sectors: ordered.slice(0, BUDGET_SECTORS_LIMIT),
      hidden: Math.max(0, ordered.length - BUDGET_SECTORS_LIMIT),
    };
  } catch {
    return null;
  }
}

/**
 * Fornecedores a homologar — os dois lados da mesma pendência:
 *
 *  1. `novos`: fornecedores cadastrados no ControlHub que ainda estão
 *     `pendente`. O filtro `from_omie = false` é ESSENCIAL: dos ~1000
 *     fornecedores em status `pendente`, quase todos são legado importado do
 *     Omie e nunca passaram pelo fluxo de homologação. Sem esse filtro o
 *     widget mostraria mil itens e não significaria nada.
 *  2. `bloqueadas`: requisições ainda em aberto cujo fornecedor não está
 *     homologado — exatamente as que vão travar no envio para pagamento.
 *     `agendado` fica de fora: já foi lançada, então o fornecedor já passou.
 *
 * Os dois blocos são derivados do ESTADO atual, não do log de notificações:
 * homologou o fornecedor, o item some sozinho.
 */
const OPEN_STATUSES_FOR_SUPPLIER_BLOCK = [
  "pendente",
  "pendente_diretor",
  "aguardando_complementacao",
  "aprovado",
  "info_pagamento_pendente",
];

async function loadSuppliers(): Promise<HomeSuppliers | null> {
  try {
    const db = createAdminClient();

    const [novosRes, bloqueadasRes] = await Promise.all([
      db
        .from("ctrl_suppliers")
        .select("id, name, created_at", { count: "exact" })
        .eq("status", "pendente")
        .eq("from_omie", false)
        .order("created_at", { ascending: false })
        .limit(5),
      db
        .from("ctrl_requests")
        .select("id, request_number, title, amount, status, ctrl_suppliers!inner(name, status)", {
          count: "exact",
        })
        .in("status", OPEN_STATUSES_FOR_SUPPLIER_BLOCK)
        .is("deleted_at", null)
        .neq("ctrl_suppliers.status", "aprovado")
        .order("request_number", { ascending: false })
        .limit(5),
    ]);

    const supplierField = (raw: unknown, field: "name" | "status"): string => {
      const v = Array.isArray(raw) ? raw[0] : raw;
      return ((v as Record<string, string> | null)?.[field] as string) ?? "";
    };

    return {
      novos: (novosRes.data ?? []).map((s) => ({
        id: s.id as string,
        name: s.name as string,
        createdAt: s.created_at as string,
      })),
      novosTotal: novosRes.count ?? 0,
      bloqueadas: (bloqueadasRes.data ?? []).map((r) => ({
        id: r.id as string,
        requestNumber: r.request_number as number,
        title: r.title as string,
        amount: Number(r.amount),
        status: r.status as string,
        supplierName: supplierField(r.ctrl_suppliers, "name"),
        supplierStatus: supplierField(r.ctrl_suppliers, "status"),
      })),
      bloqueadasTotal: bloqueadasRes.count ?? 0,
    };
  } catch {
    return null;
  }
}

// Carrega só os widgets que o usuário pode ver, em paralelo.
export async function loadHomeCtrlData(params: {
  userId: string;
  sectorIds: string[];
  caps: HomeCtrlCaps;
}): Promise<HomeCtrlData> {
  const { userId, sectorIds, caps } = params;
  const [approvals, payments, myRequests, budget, suppliers] = await Promise.all([
    caps.canApprove ? loadApprovals(userId, caps.approvalsGlobal) : Promise.resolve(null),
    caps.canPay ? loadPayments() : Promise.resolve(null),
    caps.canRequest ? loadMyRequests(userId) : Promise.resolve(null),
    caps.canBudget ? loadBudget(sectorIds, caps.budgetAllSectors) : Promise.resolve(null),
    caps.canHomologate ? loadSuppliers() : Promise.resolve(null),
  ]);
  return { approvals, payments, myRequests, budget, suppliers };
}
