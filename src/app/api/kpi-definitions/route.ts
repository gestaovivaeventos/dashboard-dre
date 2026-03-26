import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";

export async function GET() {
  const { supabase, user } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("kpi_definitions")
    .select(
      "id,name,description,formula_type,numerator_account_codes,denominator_account_codes,multiply_by,sort_order,active",
    )
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ kpis: data ?? [] });
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
    name?: string;
    description?: string;
    formula_type?: "percentage" | "value" | "ratio";
    numerator_account_codes?: string[];
    denominator_account_codes?: string[];
    multiply_by?: number;
    sort_order?: number;
    active?: boolean;
  };

  if (!body.name || !body.formula_type || !body.numerator_account_codes?.length) {
    return NextResponse.json(
      { error: "Informe nome, tipo e contas do numerador." },
      { status: 400 },
    );
  }

  const payload = {
    name: body.name.trim(),
    description: body.description?.trim() || null,
    formula_type: body.formula_type,
    numerator_account_codes: body.numerator_account_codes,
    denominator_account_codes: body.denominator_account_codes ?? [],
    multiply_by: Number(body.multiply_by ?? 1),
    sort_order: Number(body.sort_order ?? 0),
    active: body.active ?? true,
  };

  const { data, error } = await supabase
    .from("kpi_definitions")
    .insert(payload)
    .select(
      "id,name,description,formula_type,numerator_account_codes,denominator_account_codes,multiply_by,sort_order,active",
    )
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ kpi: data });
}
