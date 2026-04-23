import { redirect } from "next/navigation";

import { getCtrlUser, hasCtrlRole } from "@/lib/ctrl/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { ContasAPagarTable, type ContasRequest } from "@/components/ctrl/contas-a-pagar-table";

async function getCompanies() {
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());
  const { data, error } = await supabase
    .from("companies")
    .select("id, name")
    .eq("active", true)
    .order("name");
  if (error) {
    console.error("[contas-a-pagar] Falha ao carregar empresas:", error);
    return [];
  }
  return (data ?? []) as { id: string; name: string }[];
}

async function getContasAPagar() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ctrl_requests")
    .select(`
      id,
      request_number,
      title,
      amount,
      due_date,
      status,
      paying_company,
      sent_to_payment_at,
      inactivation_reason,
      inactivated_at,
      ctrl_suppliers(
        name,
        cnpj_cpf,
        chave_pix,
        banco,
        agencia,
        conta_corrente,
        titular_banco
      ),
      ctrl_expense_types(name)
    `)
    .in("status", ["aprovado", "agendado", "inativado_csc"])
    .order("due_date", { ascending: true, nullsFirst: false });

  if (error) return { error: error.message };
  return { requests: (data ?? []) as ContasRequest[] };
}

export default async function ContasAPagarPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  if (!hasCtrlRole(ctx, "gerente", "diretor", "csc", "contas_a_pagar", "admin")) {
    redirect("/ctrl/requisicoes");
  }

  const [{ requests = [], error }, companies] = await Promise.all([
    getContasAPagar(),
    getCompanies(),
  ]);

  const fmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const totalAprovado = requests.filter((r) => r.status === "aprovado").reduce((s, r) => s + Number(r.amount), 0);
  const totalAgendado = requests.filter((r) => r.status === "agendado").reduce((s, r) => s + Number(r.amount), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Contas a Pagar</h1>
        <p className="text-muted-foreground">
          Selecione requisições aprovadas e envie para pagamento
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border p-4 space-y-1">
          <p className="text-xs font-medium uppercase text-muted-foreground">Total pendente</p>
          <p className="text-xl font-bold">{fmt.format(totalAprovado + totalAgendado)}</p>
          <p className="text-xs text-muted-foreground">
            {requests.filter((r) => r.status !== "inativado_csc").length} requisição(ões)
          </p>
        </div>
        <div className="rounded-lg border p-4 space-y-1">
          <p className="text-xs font-medium uppercase text-muted-foreground">Aguardando envio</p>
          <p className="text-xl font-bold text-green-600">{fmt.format(totalAprovado)}</p>
        </div>
        <div className="rounded-lg border p-4 space-y-1">
          <p className="text-xs font-medium uppercase text-muted-foreground">Enviado / Agendado</p>
          <p className="text-xl font-bold text-sky-600">{fmt.format(totalAgendado)}</p>
        </div>
      </div>

      <ContasAPagarTable requests={requests} ctrlRoles={ctx.ctrlRoles} companies={companies} />
    </div>
  );
}
