import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

interface Params {
  params: {
    companyId: string;
    partnerId: string;
  };
}

/**
 * PUT — Substitui o conjunto de vinculos cliente/fornecedor do socio.
 * Body: { supplier_customers: string[] }
 *
 * Estrategia: delete-all + insert-new dentro do escopo (company, partner).
 * Mais simples que diff e o volume e pequeno (dezenas de nomes por
 * empresa). Como ha UNIQUE(company_id, supplier_customer), inserir um
 * nome que ja pertence a outro socio na mesma empresa retorna 409.
 */
export async function PUT(request: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (!profile || profile.role !== "admin") {
    return NextResponse.json(
      { error: "Apenas admin pode alterar vinculos." },
      { status: 403 },
    );
  }

  const body = (await request.json()) as { supplier_customers?: unknown };
  if (!Array.isArray(body.supplier_customers)) {
    return NextResponse.json(
      { error: "supplier_customers deve ser um array." },
      { status: 400 },
    );
  }

  // Sanitiza, remove duplicatas e vazios.
  const supplierNames = Array.from(
    new Set(
      body.supplier_customers
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );

  const db = createAdminClientIfAvailable() ?? supabase;

  // Confere se o socio pertence a empresa (defesa em profundidade — RLS
  // ja filtra mas validar evita erro silencioso quando body vem incorreto).
  const { data: partnerRow } = await db
    .from("company_partners")
    .select("id")
    .eq("id", params.partnerId)
    .eq("company_id", params.companyId)
    .maybeSingle();
  if (!partnerRow) {
    return NextResponse.json({ error: "Socio nao encontrado." }, { status: 404 });
  }

  const { error: deleteError } = await db
    .from("company_partner_supplier_links")
    .delete()
    .eq("partner_id", params.partnerId);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 400 });
  }

  if (supplierNames.length === 0) {
    return NextResponse.json({ ok: true, links: [] });
  }

  const { data: inserted, error: insertError } = await db
    .from("company_partner_supplier_links")
    .insert(
      supplierNames.map((supplier_customer) => ({
        partner_id: params.partnerId,
        company_id: params.companyId,
        supplier_customer,
      })),
    )
    .select("id, supplier_customer");

  if (insertError) {
    // Codigo 23505 = unique violation. Mensagem amigavel.
    const code = (insertError as { code?: string }).code;
    if (code === "23505") {
      return NextResponse.json(
        {
          error:
            "Um ou mais clientes/fornecedores selecionados ja estao vinculados a outro socio nesta empresa.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: insertError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, links: inserted ?? [] });
}
