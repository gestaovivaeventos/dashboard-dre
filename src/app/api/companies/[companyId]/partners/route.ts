import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

interface Params {
  params: {
    companyId: string;
  };
}

interface PartnerRow {
  id: string;
  name: string;
  sort_order: number;
  historical_dividends_value: number;
  historical_aportes_value: number;
  links: Array<{ id: string; supplier_customer: string }>;
}

/**
 * GET — Lista todos os socios da empresa com seus vinculos de
 * cliente/fornecedor da Omie.
 */
export async function GET(_request: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (!profile || profile.role !== "admin") {
    return NextResponse.json(
      { error: "Apenas admin pode acessar configuracao de socios." },
      { status: 403 },
    );
  }

  const db = createAdminClientIfAvailable() ?? supabase;

  const [partnersResult, linksResult] = await Promise.all([
    db
      .from("company_partners")
      .select("id, name, sort_order, historical_dividends_value, historical_aportes_value")
      .eq("company_id", params.companyId)
      .order("sort_order")
      .order("id"),
    db
      .from("company_partner_supplier_links")
      .select("id, partner_id, supplier_customer")
      .eq("company_id", params.companyId),
  ]);

  if (partnersResult.error) {
    return NextResponse.json({ error: partnersResult.error.message }, { status: 400 });
  }
  if (linksResult.error) {
    return NextResponse.json({ error: linksResult.error.message }, { status: 400 });
  }

  const linksByPartner = new Map<string, Array<{ id: string; supplier_customer: string }>>();
  for (const link of linksResult.data ?? []) {
    const row = link as { id: string; partner_id: string; supplier_customer: string };
    const list = linksByPartner.get(row.partner_id) ?? [];
    list.push({ id: row.id, supplier_customer: row.supplier_customer });
    linksByPartner.set(row.partner_id, list);
  }

  const partners: PartnerRow[] = (partnersResult.data ?? []).map((p) => {
    const row = p as {
      id: string;
      name: string;
      sort_order: number;
      historical_dividends_value: number | string | null;
      historical_aportes_value: number | string | null;
    };
    return {
      id: row.id,
      name: row.name,
      sort_order: row.sort_order,
      historical_dividends_value: Number(row.historical_dividends_value ?? 0),
      historical_aportes_value: Number(row.historical_aportes_value ?? 0),
      links: (linksByPartner.get(row.id) ?? []).sort((a, b) =>
        a.supplier_customer.localeCompare(b.supplier_customer),
      ),
    };
  });

  return NextResponse.json({ partners });
}

/**
 * POST — Cria novo socio.
 * Body: { name: string }
 *
 * sort_order e atribuido automaticamente como max(sort_order)+1.
 */
export async function POST(request: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (!profile || profile.role !== "admin") {
    return NextResponse.json(
      { error: "Apenas admin pode criar socios." },
      { status: 403 },
    );
  }

  const body = (await request.json()) as { name?: string };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Nome do socio e obrigatorio." }, { status: 400 });
  }

  const db = createAdminClientIfAvailable() ?? supabase;

  const { data: maxRow } = await db
    .from("company_partners")
    .select("sort_order")
    .eq("company_id", params.companyId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((maxRow as { sort_order: number } | null)?.sort_order ?? 0) + 1;

  const { data, error } = await db
    .from("company_partners")
    .insert({
      company_id: params.companyId,
      name,
      sort_order: nextOrder,
      updated_by: profile.id,
    })
    .select("id, name, sort_order")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Falha ao criar socio." },
      { status: 400 },
    );
  }

  const row = data as { id: string; name: string; sort_order: number };
  return NextResponse.json({
    partner: {
      id: row.id,
      name: row.name,
      sort_order: row.sort_order,
      historical_dividends_value: 0,
      historical_aportes_value: 0,
      links: [],
    },
  });
}
