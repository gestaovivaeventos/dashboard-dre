import "server-only";

import type { CtrlUserContext } from "@/lib/ctrl/auth";
import { etapaDaRequisicao, ETAPA_LABEL, respostaPendente } from "@/lib/ext-api/requisicoes";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CtrlRequestStatus } from "@/lib/supabase/types";

// Leituras da API externa. Sempre pelo admin client COM o recorte explícito
// (empresa da chave + criada por quem age): a API serve só ao solicitante,
// então nenhuma leitura aqui alcança requisição de outra pessoa ou empresa.

const COLUMNS = `
  id, request_number, title, description, amount, due_date, status, created_at,
  payment_method, reference_month, reference_year, installment_number, installment_total,
  omie_launch_status, omie_paid_at, scheduled_for, sector_id, expense_type_id, supplier_id,
  ctrl_sectors(name), ctrl_expense_types(name), ctrl_suppliers(name)
`;

interface Row {
  id: string;
  request_number: number;
  title: string;
  description: string | null;
  amount: number;
  due_date: string | null;
  status: CtrlRequestStatus;
  created_at: string;
  payment_method: string | null;
  reference_month: number | null;
  reference_year: number | null;
  installment_number: number | null;
  installment_total: number | null;
  omie_launch_status: string | null;
  omie_paid_at: string | null;
  scheduled_for: string | null;
  sector_id: string;
  expense_type_id: string | null;
  supplier_id: string | null;
  ctrl_sectors: { name: string } | null;
  ctrl_expense_types: { name: string } | null;
  ctrl_suppliers: { name: string } | null;
}

function toView(r: Row) {
  const etapa = etapaDaRequisicao(r);
  return {
    id: r.id,
    numero: r.request_number,
    titulo: r.title,
    descricao: r.description,
    valor: Number(r.amount),
    vencimento: r.due_date,
    referencia: r.reference_month && r.reference_year ? { mes: r.reference_month, ano: r.reference_year } : null,
    formaPagamento: r.payment_method,
    parcela: r.installment_total ? { numero: r.installment_number, total: r.installment_total } : null,
    setor: r.ctrl_sectors ? { id: r.sector_id, nome: r.ctrl_sectors.name } : null,
    tipoDespesa: r.ctrl_expense_types ? { id: r.expense_type_id, nome: r.ctrl_expense_types.name } : null,
    fornecedor: r.ctrl_suppliers ? { id: r.supplier_id, nome: r.ctrl_suppliers.name } : null,
    etapa,
    etapaLabel: ETAPA_LABEL[etapa],
    respostaPendente: respostaPendente(r.status),
    status: r.status,
    pagoEm: r.omie_paid_at,
    criadaEm: r.created_at,
  };
}

export type RequisicaoView = ReturnType<typeof toView>;

export async function listOwnRequests(ctx: CtrlUserContext, limit = 200): Promise<RequisicaoView[]> {
  const { data, error } = await createAdminClient()
    .from("ctrl_requests")
    .select(COLUMNS)
    .eq("org_id", ctx.orgId!)
    .eq("created_by", ctx.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Row[]).map(toView);
}

/** A requisição, se for da empresa da chave E criada por quem age; senão null. */
export async function getOwnRequest(ctx: CtrlUserContext, id: string): Promise<RequisicaoView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await createAdminClient()
    .from("ctrl_requests")
    .select(COLUMNS)
    .eq("id", id)
    .eq("org_id", ctx.orgId!)
    .eq("created_by", ctx.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toView(data as unknown as Row) : null;
}

/**
 * Fornecedor e tipo de despesa têm de ser da empresa da chave. createRequest
 * confere só o setor; a tela nunca oferece cadastro de outra empresa, mas uma
 * chamada direta poderia mandar um fornecedor da Viva numa despesa da Feat.
 */
export async function catalogOutsideOrg(
  ctx: CtrlUserContext,
  ids: { supplierId: string; expenseTypeId: string },
): Promise<string | null> {
  const admin = createAdminClient();
  const [{ data: supplier }, { data: type }] = await Promise.all([
    admin.from("ctrl_suppliers").select("org_id").eq("id", ids.supplierId).maybeSingle(),
    admin.from("ctrl_expense_types").select("org_id, active").eq("id", ids.expenseTypeId).maybeSingle(),
  ]);
  if (!supplier || supplier.org_id !== ctx.orgId) return "Fornecedor não encontrado nesta empresa.";
  if (!type || type.org_id !== ctx.orgId || !type.active) return "Tipo de despesa não encontrado nesta empresa.";
  return null;
}
