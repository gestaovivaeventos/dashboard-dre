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
 * PUT — Atualiza nome do socio e/ou seus saldos historicos pre-Omie.
 *
 * Body (todos opcionais; pelo menos um obrigatorio):
 *   { name?: string,
 *     historical_dividends_value?: number,
 *     historical_aportes_value?: number }
 *
 * Os saldos historicos sao usados APENAS na secao "Acumulados" da tela
 * Fluxo de Caixa — nao alteram as linhas normais 4.2 / 5.1 nem o calculo
 * de saldo. Valor 0 (ou ausencia) = comportamento atual preservado.
 */
export async function PUT(request: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (!profile || profile.role !== "admin") {
    return NextResponse.json(
      { error: "Apenas admin pode editar socios." },
      { status: 403 },
    );
  }

  const body = (await request.json()) as {
    name?: unknown;
    historical_dividends_value?: unknown;
    historical_aportes_value?: unknown;
  };

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: profile.id,
  };

  if (body.name !== undefined) {
    if (typeof body.name !== "string") {
      return NextResponse.json({ error: "Nome invalido." }, { status: 400 });
    }
    const trimmed = body.name.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "Nome do socio e obrigatorio." }, { status: 400 });
    }
    update.name = trimmed;
  }

  const parseHistorical = (value: unknown, field: string): number | { error: string } => {
    if (value === null || value === undefined || value === "") {
      return 0;
    }
    const num = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(num)) {
      return { error: `${field} deve ser um numero.` };
    }
    if (num < 0) {
      return { error: `${field} nao pode ser negativo.` };
    }
    // Arredonda para 2 casas para evitar lixo de ponto flutuante.
    return Math.round(num * 100) / 100;
  };

  if (body.historical_dividends_value !== undefined) {
    const parsed = parseHistorical(
      body.historical_dividends_value,
      "Dividendos historicos pre-Omie",
    );
    if (typeof parsed === "object") {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    update.historical_dividends_value = parsed;
  }
  if (body.historical_aportes_value !== undefined) {
    const parsed = parseHistorical(
      body.historical_aportes_value,
      "Aportes historicos pre-Omie",
    );
    if (typeof parsed === "object") {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    update.historical_aportes_value = parsed;
  }

  // Precisa ter pelo menos um campo de negocio para atualizar.
  const hasBusinessField =
    "name" in update
    || "historical_dividends_value" in update
    || "historical_aportes_value" in update;
  if (!hasBusinessField) {
    return NextResponse.json(
      { error: "Informe ao menos um campo para atualizar." },
      { status: 400 },
    );
  }

  const db = createAdminClientIfAvailable() ?? supabase;

  const { error } = await db
    .from("company_partners")
    .update(update)
    .eq("id", params.partnerId)
    .eq("company_id", params.companyId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE — Remove o socio (e seus vinculos via ON DELETE CASCADE).
 */
export async function DELETE(_request: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (!profile || profile.role !== "admin") {
    return NextResponse.json(
      { error: "Apenas admin pode remover socios." },
      { status: 403 },
    );
  }

  const db = createAdminClientIfAvailable() ?? supabase;

  const { error } = await db
    .from("company_partners")
    .delete()
    .eq("id", params.partnerId)
    .eq("company_id", params.companyId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
