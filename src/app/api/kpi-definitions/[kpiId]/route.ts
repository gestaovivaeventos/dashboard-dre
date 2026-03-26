import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";

interface Params {
  params: {
    kpiId: string;
  };
}

export async function PATCH(request: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const body = (await request.json()) as {
    name?: string;
    description?: string;
    formula_type?: "percentage" | "value" | "ratio";
    numerator_account_codes?: string[];
    denominator_account_codes?: string[];
    multiply_by?: number;
    sort_order?: number;
    active?: boolean;
  };

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") patch.name = body.name.trim();
  if (body.description !== undefined) patch.description = body.description?.trim() || null;
  if (body.formula_type) patch.formula_type = body.formula_type;
  if (body.numerator_account_codes) patch.numerator_account_codes = body.numerator_account_codes;
  if (body.denominator_account_codes) patch.denominator_account_codes = body.denominator_account_codes;
  if (body.multiply_by !== undefined) patch.multiply_by = Number(body.multiply_by);
  if (body.sort_order !== undefined) patch.sort_order = Number(body.sort_order);
  if (body.active !== undefined) patch.active = body.active;

  const { data, error } = await supabase
    .from("kpi_definitions")
    .update(patch)
    .eq("id", params.kpiId)
    .select(
      "id,name,description,formula_type,numerator_account_codes,denominator_account_codes,multiply_by,sort_order,active",
    )
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "KPI nao encontrado." }, { status: 400 });
  }

  return NextResponse.json({ kpi: data });
}

export async function DELETE(_: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const { error } = await supabase.from("kpi_definitions").delete().eq("id", params.kpiId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
