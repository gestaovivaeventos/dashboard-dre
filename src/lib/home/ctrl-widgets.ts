import { createAdminClient } from "@/lib/supabase/admin";
import type { CtrlRole } from "@/lib/supabase/types";

export const fmtBRL = new Intl.NumberFormat("pt-BR", {
  style: "decimal",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Capacidades derivadas dos papéis CTRL do usuário.
export interface HomeCtrlCaps {
  canApprove: boolean; // vê widget de aprovações
  canPay: boolean; // vê fila de pagamento
  canRequest: boolean; // vê "minhas requisições"
  canBudget: boolean; // vê orçamento do setor
}

export function deriveCtrlCaps(roles: CtrlRole[], sectorIds: string[]): HomeCtrlCaps {
  const has = (...r: CtrlRole[]) => roles.some((x) => r.includes(x));
  return {
    canApprove: has("gerente", "diretor", "csc", "admin"),
    canPay: has("contas_a_pagar", "csc", "admin"),
    canRequest: has("solicitante", "gerente", "diretor", "csc", "admin"),
    canBudget: has("gerente", "diretor") && sectorIds.length > 0,
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

export interface HomeCtrlData {
  approvals: HomeApprovals | null;
  payments: HomePayments | null;
  myRequests: HomeMyRequests | null;
  budget: HomeBudgetSector[] | null;
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

async function loadApprovals(roles: CtrlRole[]): Promise<HomeApprovals | null> {
  try {
    const db = createAdminClient();
    const canDirector = roles.some((r) => ["diretor", "csc", "admin"].includes(r));
    const statuses = canDirector ? ["pendente", "pendente_diretor"] : ["pendente"];

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
      aprovadas: count("aprovado", "agendado"),
      rejeitadas: count("rejeitado"),
      total: rows.length,
    };
  } catch {
    return null;
  }
}

async function loadBudget(sectorIds: string[]): Promise<HomeBudgetSector[] | null> {
  try {
    const db = createAdminClient();
    const year = new Date().getFullYear();

    const [{ data: budgets }, { data: reqs }, { data: sectors }] = await Promise.all([
      db
        .from("ctrl_budget")
        .select("sector_id, amount")
        .in("sector_id", sectorIds)
        .eq("period_year", year),
      db
        .from("ctrl_requests")
        .select("sector_id, amount")
        .in("sector_id", sectorIds)
        .eq("reference_year", year)
        .in("status", ["aprovado", "agendado", "info_pagamento_pendente"])
        .is("deleted_at", null),
      db.from("ctrl_sectors").select("id, name").in("id", sectorIds),
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

    return (sectors ?? []).map((s) => ({
      sectorId: s.id as string,
      sectorName: s.name as string,
      orcadoAnual: orcado.get(s.id as string) ?? 0,
      consumido: consumido.get(s.id as string) ?? 0,
    }));
  } catch {
    return null;
  }
}

// Carrega só os widgets que o usuário pode ver, em paralelo.
export async function loadHomeCtrlData(params: {
  userId: string;
  roles: CtrlRole[];
  sectorIds: string[];
  caps: HomeCtrlCaps;
}): Promise<HomeCtrlData> {
  const { userId, roles, sectorIds, caps } = params;
  const [approvals, payments, myRequests, budget] = await Promise.all([
    caps.canApprove ? loadApprovals(roles) : Promise.resolve(null),
    caps.canPay ? loadPayments() : Promise.resolve(null),
    caps.canRequest ? loadMyRequests(userId) : Promise.resolve(null),
    caps.canBudget ? loadBudget(sectorIds) : Promise.resolve(null),
  ]);
  return { approvals, payments, myRequests, budget };
}
