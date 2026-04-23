import { redirect } from "next/navigation";

import { getCtrlUser, hasCtrlRole } from "@/lib/ctrl/auth";
import { getSectors } from "@/lib/ctrl/actions/sectors";
import { createClient } from "@/lib/supabase/server";
import { RelatoriosClient } from "@/components/ctrl/relatorios-client";

async function getRelatorioData(params: {
  sectorId?: string;
  status?: string;
  monthFrom?: number;
  monthTo?: number;
  year?: number;
}) {
  const supabase = await createClient();

  let query = supabase
    .from("ctrl_requests")
    .select(`
      id,
      request_number,
      title,
      amount,
      status,
      due_date,
      created_at,
      payment_method,
      reference_month,
      reference_year,
      paying_company,
      ctrl_sectors(name),
      ctrl_expense_types(name),
      ctrl_suppliers(name),
      creator:users!ctrl_requests_created_by_fkey(name, email)
    `)
    .order("created_at", { ascending: false });

  if (params.sectorId) query = query.eq("sector_id", params.sectorId);
  if (params.status) query = query.eq("status", params.status);
  if (params.year) query = query.eq("reference_year", params.year);
  if (params.monthFrom) query = query.gte("reference_month", params.monthFrom);
  if (params.monthTo) query = query.lte("reference_month", params.monthTo);

  const { data, error } = await query.limit(500);
  if (error) return { error: error.message };
  return { requests: data ?? [] };
}

export default async function RelatoriosPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  if (!hasCtrlRole(ctx, "gerente", "diretor", "csc", "contas_a_pagar", "admin")) {
    redirect("/ctrl/requisicoes");
  }

  const [sectorsResult, requestsResult] = await Promise.all([
    getSectors(),
    getRelatorioData({}),
  ]);

  const sectors = sectorsResult.sectors ?? [];
  const requests = requestsResult.requests ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Relatórios</h1>
        <p className="text-muted-foreground">Analise e filtre requisições por período, setor e status</p>
      </div>

      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <RelatoriosClient requests={requests as any} sectors={sectors} />
    </div>
  );
}
