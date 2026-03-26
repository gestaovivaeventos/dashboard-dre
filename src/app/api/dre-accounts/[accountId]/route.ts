import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";

interface Params {
  params: {
    accountId: string;
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
    type?: "receita" | "despesa" | "calculado" | "misto";
    is_summary?: boolean;
    formula?: string | null;
    sort_order?: number;
    active?: boolean;
  };

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") patch.name = body.name.trim();
  if (body.type) patch.type = body.type;
  if (typeof body.is_summary === "boolean") patch.is_summary = body.is_summary;
  if (body.formula !== undefined) patch.formula = body.formula ? body.formula.trim() : null;
  if (typeof body.sort_order === "number") patch.sort_order = body.sort_order;
  if (typeof body.active === "boolean") patch.active = body.active;

  if (body.type === "calculado") {
    patch.is_summary = true;
    if (!patch.formula) {
      return NextResponse.json(
        { error: "Conta calculada exige formula obrigatoria." },
        { status: 400 },
      );
    }
  }

  const { data, error } = await supabase
    .from("dre_accounts")
    .update(patch)
    .eq("id", params.accountId)
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Conta nao encontrada." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const { count } = await supabase
    .from("dre_accounts")
    .select("*", { count: "exact", head: true })
    .eq("parent_id", params.accountId);

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: "Nao e permitido excluir contas que possuem filhos." },
      { status: 400 },
    );
  }

  const { error } = await supabase.from("dre_accounts").delete().eq("id", params.accountId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
