import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

interface Params {
  params: {
    companyId: string;
  };
}

/**
 * GET — Lista os clientes/fornecedores que ja apareceram em lancamentos
 * de Dividendos Pagos (4.2) ou Aumento de Capital (5.1) na empresa.
 *
 * Fonte: financial_entries.supplier_customer DISTINCT, filtrado pelo
 * mapeamento em cash_flow_category_mappings (RPC company_partner_candidates).
 * Nao chama Omie — usa os lancamentos ja sincronizados.
 */
export async function GET(_request: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (!profile || profile.role !== "admin") {
    return NextResponse.json(
      { error: "Apenas admin pode acessar candidatos." },
      { status: 403 },
    );
  }

  const db = createAdminClientIfAvailable() ?? supabase;

  const { data, error } = await db.rpc("company_partner_candidates", {
    p_company_id: params.companyId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  type CandidateRow = {
    supplier_customer: string;
    occurrences: number | string;
    total_value: number | string | null;
    last_payment_date: string | null;
  };

  const candidates = ((data as CandidateRow[] | null) ?? []).map((row) => ({
    supplier_customer: row.supplier_customer,
    occurrences: Number(row.occurrences ?? 0),
    total_value: Number(row.total_value ?? 0),
    last_payment_date: row.last_payment_date,
  }));

  return NextResponse.json({ candidates });
}
