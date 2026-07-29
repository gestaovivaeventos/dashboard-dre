import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptSecret } from "@/lib/security/encryption";
import { listContasStatus } from "@/lib/omie/contas-status";

// Reconciliação de pagamentos das requisições do Compras (CTRL) contra o Omie.
//
// Uma requisição enviada ao pagamento fica com status = 'agendado' ("Enviado
// Pgto") e um `omie_contapagar_codigo`. Isso significa apenas que o TÍTULO foi
// lançado no Omie — NÃO que foi pago. O pagamento de fato só existe quando o
// título é BAIXADO no Omie (status_titulo PAGO/LIQUIDADO/BAIXADO ou uma data de
// baixa/pagamento). `listContasStatus` já encapsula essa detecção (a mesma usada
// pelo módulo Case em produção): um título só enviado ao banco ou meramente
// programado permanece EMABERTO e não conta como pago aqui.
//
// Ao detectar o pagamento, gravamos `omie_paid_at` (a data da baixa quando
// disponível, senão o instante da detecção). A partir daí a UI exibe "Pago".

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any>;

export interface ReconcilePaymentsResult {
  /** Requisições candidatas verificadas contra o Omie. */
  checked: number;
  /** Requisições que passaram a "Pago" nesta execução. */
  paid: number;
  /** Empresas pagadoras consultadas. */
  companies: number;
  /** Requisições que não puderam ser verificadas (empresa sem credencial, falha Omie). */
  errors: number;
}

interface CandidateRow {
  id: string;
  amount: number;
  paying_company_id: string | null;
  omie_contapagar_codigo: number | string | null;
}

export async function reconcilePaidRequests(
  db: DB,
  opts: { companyId?: string } = {},
): Promise<ReconcilePaymentsResult> {
  // Candidatas: já enviadas ao pagamento (agendado), com título no Omie e ainda
  // não marcadas como pagas. Ignora excluídas logicamente.
  let query = db
    .from("ctrl_requests")
    .select("id, amount, paying_company_id, omie_contapagar_codigo")
    .eq("status", "agendado")
    .not("omie_contapagar_codigo", "is", null)
    .is("omie_paid_at", null)
    .is("deleted_at", null);
  if (opts.companyId) query = query.eq("paying_company_id", opts.companyId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as CandidateRow[];
  if (rows.length === 0) return { checked: 0, paid: 0, companies: 0, errors: 0 };

  // Agrupa por empresa pagadora: uma listagem de contas a pagar por empresa
  // cobre todas as suas requisições (bem mais barato que consultar título a
  // título e respeita o rate-limit da Omie).
  const byCompany = new Map<string, CandidateRow[]>();
  for (const r of rows) {
    if (!r.paying_company_id || !r.omie_contapagar_codigo) continue;
    const arr = byCompany.get(r.paying_company_id) ?? [];
    arr.push(r);
    byCompany.set(r.paying_company_id, arr);
  }

  let checked = 0;
  let paid = 0;
  let errors = 0;
  const now = new Date().toISOString();

  for (const [companyId, companyRows] of Array.from(byCompany.entries())) {
    const { data: company } = await db
      .from("companies")
      .select("omie_app_key, omie_app_secret")
      .eq("id", companyId)
      .maybeSingle();

    if (!company?.omie_app_key || !company?.omie_app_secret) {
      errors += companyRows.length;
      continue;
    }

    let statusByCode: Map<number, { pago: boolean; pagoEm: string | null }>;
    try {
      const appKey = decryptSecret(company.omie_app_key as string);
      const appSecret = decryptSecret(company.omie_app_secret as string);
      const contas = await listContasStatus(appKey, appSecret, "pagar");
      statusByCode = new Map(
        contas.map((c) => [c.omieCodigo, { pago: c.pago, pagoEm: c.pagoEm }]),
      );
    } catch {
      // Falha ao ler o Omie desta empresa: conta como erro e segue. Best-effort.
      errors += companyRows.length;
      continue;
    }

    for (const r of companyRows) {
      checked += 1;
      const st = statusByCode.get(Number(r.omie_contapagar_codigo));
      // Só marca quando o Omie confirma o pagamento (baixa). Título não
      // encontrado na listagem ou ainda em aberto → permanece "Enviado Pgto".
      if (!st?.pago) continue;

      const { error: updErr } = await db
        .from("ctrl_requests")
        .update({
          omie_paid_at: st.pagoEm ? `${st.pagoEm}T00:00:00Z` : now,
          updated_at: now,
        })
        .eq("id", r.id)
        .is("omie_paid_at", null); // guarda contra corrida (dupla marcação)
      if (updErr) {
        errors += 1;
        continue;
      }
      paid += 1;
    }
  }

  return { checked, paid, companies: byCompany.size, errors };
}
