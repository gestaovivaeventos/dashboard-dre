import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { getCurrentSessionContext } from "@/lib/auth/session";

interface ProjectMappingRow {
  id: string;
  omieProjectCode: string;
  omieProjectName: string | null;
  dreAccountRevenueId: string | null;
  dreAccountExpenseId: string | null;
  dreAccountRevenueCode: string | null;
  dreAccountRevenueName: string | null;
  dreAccountExpenseCode: string | null;
  dreAccountExpenseName: string | null;
}

export async function GET(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const url = new URL(request.url);
  const companyId = url.searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "Informe companyId." }, { status: 400 });
  }

  const [{ data: mappings, error: mappingsError }, { data: accounts, error: accountsError }] =
    await Promise.all([
      supabase
        .from("project_mapping")
        .select(
          "id,omie_project_code,omie_project_name,dre_account_revenue_id,dre_account_expense_id",
        )
        .eq("company_id", companyId)
        .order("omie_project_code"),
      // Carrega so o plano da empresa para resolver code/name das contas
      // referenciadas. Como project_mapping e sempre escopada por empresa,
      // os accounts apontados estarao em company_id = X (plano custom dela).
      supabase
        .from("dre_accounts")
        .select("id,code,name,company_id")
        .eq("company_id", companyId)
        .eq("active", true),
    ]);

  if (mappingsError) {
    return NextResponse.json({ error: mappingsError.message }, { status: 400 });
  }
  if (accountsError) {
    return NextResponse.json({ error: accountsError.message }, { status: 400 });
  }

  const accountById = new Map<string, { code: string; name: string }>();
  (accounts ?? []).forEach((a) => {
    accountById.set(a.id as string, {
      code: a.code as string,
      name: a.name as string,
    });
  });

  const rows: ProjectMappingRow[] = (mappings ?? []).map((m) => {
    const revId = (m.dre_account_revenue_id as string | null) ?? null;
    const expId = (m.dre_account_expense_id as string | null) ?? null;
    const revAccount = revId ? accountById.get(revId) : null;
    const expAccount = expId ? accountById.get(expId) : null;
    return {
      id: m.id as string,
      omieProjectCode: m.omie_project_code as string,
      omieProjectName: (m.omie_project_name as string | null) ?? null,
      dreAccountRevenueId: revId,
      dreAccountExpenseId: expId,
      dreAccountRevenueCode: revAccount?.code ?? null,
      dreAccountRevenueName: revAccount?.name ?? null,
      dreAccountExpenseCode: expAccount?.code ?? null,
      dreAccountExpenseName: expAccount?.name ?? null,
    };
  });

  return NextResponse.json({ rows });
}

export async function POST(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const body = (await request.json()) as {
    companyId?: string;
    omieProjectCode?: string;
    omieProjectName?: string | null;
    dreAccountRevenueId?: string | null;
    dreAccountExpenseId?: string | null;
  };

  const companyId = body.companyId?.trim();
  const omieProjectCode = body.omieProjectCode?.trim();
  const omieProjectName = body.omieProjectName?.trim() || null;
  const dreAccountRevenueId = body.dreAccountRevenueId?.trim() || null;
  const dreAccountExpenseId = body.dreAccountExpenseId?.trim() || null;

  if (!companyId || !omieProjectCode) {
    return NextResponse.json(
      { error: "Informe companyId e omieProjectCode." },
      { status: 400 },
    );
  }
  if (!dreAccountRevenueId && !dreAccountExpenseId) {
    return NextResponse.json(
      { error: "Defina ao menos uma das contas (receita ou despesa)." },
      { status: 400 },
    );
  }

  // Valida que as contas referenciadas pertencem a empresa (plano custom)
  // — projeto-mapping nao deve apontar para contas de outra empresa nem do
  // plano global, ja que e uma regra dedicada a um plano per-company.
  const candidateIds = [dreAccountRevenueId, dreAccountExpenseId].filter(
    (id): id is string => Boolean(id),
  );
  if (candidateIds.length > 0) {
    const { data: validAccounts, error: validateError } = await supabase
      .from("dre_accounts")
      .select("id,company_id")
      .in("id", candidateIds);
    if (validateError) {
      return NextResponse.json({ error: validateError.message }, { status: 400 });
    }
    const validById = new Map(
      (validAccounts ?? []).map((a) => [a.id as string, a.company_id as string | null]),
    );
    for (const id of candidateIds) {
      const ownerCompanyId = validById.get(id);
      if (ownerCompanyId === undefined) {
        return NextResponse.json(
          { error: "Conta DRE referenciada nao encontrada." },
          { status: 400 },
        );
      }
      if (ownerCompanyId !== companyId) {
        return NextResponse.json(
          {
            error:
              "Conta DRE referenciada nao pertence ao plano custom desta empresa. Crie o plano custom antes de mapear projetos.",
          },
          { status: 400 },
        );
      }
    }
  }

  // Upsert por (company_id, omie_project_code).
  // Implementacao via delete + insert para nao depender de constraint de
  // upsert no PostgREST (o unique partial e mais simples de manter como
  // delete-then-insert).
  const { error: deleteError } = await supabase
    .from("project_mapping")
    .delete()
    .eq("company_id", companyId)
    .eq("omie_project_code", omieProjectCode);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("project_mapping")
    .insert({
      company_id: companyId,
      omie_project_code: omieProjectCode,
      omie_project_name: omieProjectName,
      dre_account_revenue_id: dreAccountRevenueId,
      dre_account_expense_id: dreAccountExpenseId,
      updated_by: user.id,
    })
    .select("id,omie_project_code,omie_project_name,dre_account_revenue_id,dre_account_expense_id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  revalidatePath("/(app)", "layout");
  return NextResponse.json({ ok: true, mapping: data });
}
