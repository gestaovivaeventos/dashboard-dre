import { redirect } from "next/navigation";

import { getCtrlUser, hasCtrlRole } from "@/lib/ctrl/auth";
import { hasCtrlFullView } from "@/lib/ctrl/full-view";
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
    .not("omie_app_key", "is", null)
    .not("omie_app_secret", "is", null)
    .order("name");
  if (error) {
    console.error("[contas-a-pagar] Falha ao carregar empresas:", error);
    return [];
  }
  return (data ?? []) as { id: string; name: string }[];
}

async function getContasAPagar() {
  // Admin client (service role) para que o join embutido em `users` resolva
  // criador/aprovador — a RLS de `users` só expõe a própria linha a não-admins,
  // o que zeraria "Criado por"/"Aprovado por". A autorização já é feita na
  // página (gate por papel) e replicada pela policy ctrl_requests_read_all.
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const { data, error } = await supabase
    .from("ctrl_requests")
    .select(`
      id,
      request_number,
      title,
      description,
      amount,
      due_date,
      reference_month,
      reference_year,
      status,
      is_rateio,
      sector_id,
      expense_type_id,
      event_id,
      paying_company,
      paying_company_id,
      omie_launch_status,
      omie_contapagar_codigo,
      omie_launch_error,
      sent_to_payment_at,
      omie_paid_at,
      usd_amount,
      usd_brl_rate,
      iof_rate,
      payment_method,
      installment_number,
      installment_total,
      needs_credit_card,
      justification,
      observations,
      barcode,
      pix_key,
      pix_key_type,
      bank_name,
      bank_agency,
      bank_account,
      bank_account_digit,
      bank_cpf_cnpj,
      favorecido,
      supplier_issues_invoice,
      invoice_number,
      attachment_path,
      created_at,
      approved_at,
      ctrl_suppliers(
        name,
        cnpj_cpf,
        status,
        chave_pix,
        banco,
        agencia,
        conta_corrente,
        titular_banco
      ),
      ctrl_expense_types(name),
      ctrl_sectors(name),
      ctrl_events(name),
      creator:users!ctrl_requests_created_by_fkey(name, email),
      approver:users!ctrl_requests_approved_by_fkey(name, email)
    `)
    .in("status", ["aprovado", "agendado", "info_pagamento_pendente"])
    .is("deleted_at", null) // exclui requisições excluídas logicamente
    .order("due_date", { ascending: true, nullsFirst: false });

  if (error) return { error: error.message };

  // ── Prévia da Categoria Omie (mapeamento tipo de despesa → categoria) ──────
  // O mapeamento é por empresa pagadora. Antes do envio não há empresa, então
  // usamos como PRÉVIA a empresa com mais mapeamentos (a pagadora principal);
  // nas Enviadas usamos a empresa que de fato pagou. Sem mapeamento → "—".
  const [{ data: mapRows }, { data: optRows }] = await Promise.all([
    supabase
      .from("ctrl_expense_type_omie_categoria")
      .select("expense_type_id, company_id, codigo_categoria, codigo_categoria_sem_nota"),
    supabase
      .from("ctrl_omie_options")
      .select("company_id, codigo, descricao")
      .eq("kind", "categoria"),
  ]);

  // Empresa de prévia = a que tem mais mapeamentos de categoria.
  const mapCount = new Map<string, number>();
  for (const m of mapRows ?? []) {
    const cid = m.company_id as string;
    mapCount.set(cid, (mapCount.get(cid) ?? 0) + 1);
  }
  let previewCompanyId: string | null = null;
  let best = -1;
  for (const [cid, n] of Array.from(mapCount.entries())) {
    if (n > best) { best = n; previewCompanyId = cid; }
  }

  // `${company}:${expense_type}` → { com, sem } | `${company}:${codigo}` → descricao
  const mapByKey = new Map<string, { com: string | null; sem: string | null }>();
  for (const m of mapRows ?? []) {
    mapByKey.set(`${m.company_id}:${m.expense_type_id}`, {
      com: (m.codigo_categoria as string | null) ?? null,
      sem: (m.codigo_categoria_sem_nota as string | null) ?? null,
    });
  }
  const optByKey = new Map<string, string>();
  for (const o of optRows ?? []) optByKey.set(`${o.company_id}:${o.codigo}`, o.descricao as string);

  const resolveCategoria = (r: {
    expense_type_id?: string | null;
    paying_company_id?: string | null;
    supplier_issues_invoice?: string | null;
  }): string | null => {
    if (!r.expense_type_id) return null;
    const company = r.paying_company_id ?? previewCompanyId;
    if (!company) return null;
    const m = mapByKey.get(`${company}:${r.expense_type_id}`);
    if (!m) return null;
    const codigo = r.supplier_issues_invoice === "nao" ? m.sem ?? m.com : m.com;
    if (!codigo) return null;
    return optByKey.get(`${company}:${codigo}`) ?? codigo;
  };

  // Parcelas dos rateios (setor + valor + status) para exibir "Rateio" na coluna
  // Setor e o detalhamento no modal. Mesma fonte da tela de Aprovações.
  const rateioIds = (data ?? []).filter((r) => r.is_rateio).map((r) => r.id as string);
  const portionsByReq = new Map<string, unknown[]>();
  if (rateioIds.length) {
    const { data: portions } = await supabase
      .from("ctrl_request_sectors")
      .select("request_id, sector_id, amount, status, approval_tier, ctrl_sectors(name)")
      .in("request_id", rateioIds);
    for (const p of portions ?? []) {
      const key = (p as { request_id: string }).request_id;
      const arr = portionsByReq.get(key) ?? [];
      arr.push(p);
      portionsByReq.set(key, arr);
    }
  }

  const requests = (data ?? []).map((r) => ({
    ...r,
    categoria: resolveCategoria(r as Parameters<typeof resolveCategoria>[0]),
    ...(r.is_rateio ? { ctrl_request_sectors: portionsByReq.get(r.id as string) ?? [] } : {}),
  })) as ContasRequest[];

  return { requests };
}

// Cadastros para o modal de correção de setor/tipo. Busca TODOS os ativos via
// admin client — o perfil contas_a_pagar não é coberto pelo gate de getSectors/
// getExpenseTypes (e getSectors ainda filtraria por vínculo de setor do usuário).
async function getCadastros() {
  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const [sec, exp] = await Promise.all([
    supabase.from("ctrl_sectors").select("id, name").eq("active", true).order("name"),
    supabase.from("ctrl_expense_types").select("id, name").eq("active", true).order("name"),
  ]);
  return {
    sectors: (sec.data ?? []) as { id: string; name: string }[],
    expenseTypes: (exp.data ?? []) as { id: string; name: string }[],
  };
}

export default async function ContasAPagarPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  // Contas a Pagar é exclusivo do perfil Contas a Pagar (+ admin). Demais
  // perfis (gerente/diretor/solicitante) não veem nem acessam o menu. A visão
  // completa do módulo (override nominal — @/lib/ctrl/full-view) entra aqui com
  // as mesmas ações da tela: enviar ao pagamento, devolver, pedir info e
  // corrigir setor/tipo (as server actions correspondentes usam
  // requireCtrlRoleOrFullView).
  const canOperate =
    hasCtrlRole(ctx, "contas_a_pagar", "admin") || hasCtrlFullView(ctx.email);
  if (!canOperate) {
    redirect("/ctrl/requisicoes");
  }

  // Só carrega os cadastros de setor/tipo quando o usuário pode editar; os
  // demais recebem listas vazias.
  const canEditRouting = canOperate;
  const [{ requests = [], error }, companies, cadastros] = await Promise.all([
    getContasAPagar(),
    getCompanies(),
    canEditRouting ? getCadastros() : Promise.resolve({ sectors: [], expenseTypes: [] }),
  ]);

  const fmt = new Intl.NumberFormat("pt-BR", { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
            {requests.length} requisição(ões)
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

      <ContasAPagarTable
        requests={requests}
        ctrlRoles={ctx.ctrlRoles}
        companies={companies}
        sectors={cadastros.sectors}
        expenseTypes={cadastros.expenseTypes}
        canOperate={canOperate}
      />
    </div>
  );
}
