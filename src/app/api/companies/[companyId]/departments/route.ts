import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { syncCompanyDepartments } from "@/lib/omie/sync";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

interface Params {
  params: {
    companyId: string;
  };
}

interface DepartmentRow {
  id: string;
  omie_code: string;
  name: string;
  included: boolean;
  synced_at: string | null;
}

interface CompanyRow {
  id: string;
  has_department_apportionment: boolean;
}

/**
 * GET — Retorna a configuracao de rateio por departamento da empresa e a
 * lista de departamentos (ja sincronizados). Quando `?refresh=1`, antes
 * busca o catalogo atualizado da Omie via ListarDepartamentos e faz upsert
 * em `company_departments` (preserva `included` ja marcado).
 */
export async function GET(request: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (!profile || profile.role !== "admin") {
    return NextResponse.json(
      { error: "Apenas admin pode acessar configuracao de departamentos." },
      { status: 403 },
    );
  }

  const db = createAdminClientIfAvailable() ?? supabase;
  const url = new URL(request.url);
  const refresh = url.searchParams.get("refresh") === "1";

  if (refresh) {
    try {
      await syncCompanyDepartments(params.companyId);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Falha ao buscar departamentos na Omie.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  const [companyResult, departmentsResult] = await Promise.all([
    db
      .from("companies")
      .select("id, has_department_apportionment")
      .eq("id", params.companyId)
      .single<CompanyRow>(),
    db
      .from("company_departments")
      .select("id, omie_code, name, included, synced_at")
      .eq("company_id", params.companyId)
      .order("omie_code"),
  ]);

  if (companyResult.error || !companyResult.data) {
    return NextResponse.json({ error: "Empresa nao encontrada." }, { status: 404 });
  }

  const departments = (departmentsResult.data ?? []) as DepartmentRow[];
  return NextResponse.json({
    has_department_apportionment: companyResult.data.has_department_apportionment,
    departments,
  });
}

/**
 * PUT — Atualiza a configuracao de rateio.
 * Body:
 *   {
 *     has_department_apportionment: boolean,
 *     included_codes: string[]   // codigos Omie marcados (inclui "__none__"
 *                                // se o usuario quer trazer lancamentos
 *                                // sem departamento vinculado)
 *   }
 *
 * Estrategia de update:
 *   - Atualiza flag em `companies`.
 *   - Marca `included = true` somente para os codigos em `included_codes`,
 *     `false` para todos os outros (single source of truth).
 *   - Se nao houver `__none__` na tabela ainda (empresa que nunca rodou
 *     sync de departamentos), cria a sentinela.
 */
export async function PUT(request: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (!profile || profile.role !== "admin") {
    return NextResponse.json(
      { error: "Apenas admin pode alterar configuracao de departamentos." },
      { status: 403 },
    );
  }

  const body = (await request.json()) as {
    has_department_apportionment?: boolean;
    included_codes?: string[];
  };

  const hasFlag = Boolean(body.has_department_apportionment);
  const includedCodes = Array.isArray(body.included_codes) ? body.included_codes : [];

  const db = createAdminClientIfAvailable() ?? supabase;

  const { error: companyError } = await db
    .from("companies")
    .update({ has_department_apportionment: hasFlag })
    .eq("id", params.companyId);
  if (companyError) {
    return NextResponse.json({ error: companyError.message }, { status: 400 });
  }

  // Garante a sentinela __none__ existir (necessaria para o usuario poder
  // marcar lancamentos sem departamento vinculado).
  const { data: noneRow } = await db
    .from("company_departments")
    .select("id")
    .eq("company_id", params.companyId)
    .eq("omie_code", "__none__")
    .maybeSingle();
  if (!noneRow) {
    await db.from("company_departments").insert({
      company_id: params.companyId,
      omie_code: "__none__",
      name: "Sem departamento vinculado",
      included: false,
    });
  }

  // Atualiza os flags `included` em batch.
  // Primeiro: zera todos.
  const { error: clearError } = await db
    .from("company_departments")
    .update({ included: false })
    .eq("company_id", params.companyId);
  if (clearError) {
    return NextResponse.json({ error: clearError.message }, { status: 400 });
  }

  if (includedCodes.length > 0) {
    const { error: setError } = await db
      .from("company_departments")
      .update({ included: true })
      .eq("company_id", params.companyId)
      .in("omie_code", includedCodes);
    if (setError) {
      return NextResponse.json({ error: setError.message }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true });
}
