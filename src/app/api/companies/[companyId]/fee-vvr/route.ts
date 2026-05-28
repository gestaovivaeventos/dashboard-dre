import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

interface Params {
  params: {
    companyId: string;
  };
}

// ─── Tabela mensal: VVR META + VVR por (ano, mes) ─────────────────────────

interface FeeVvrRow {
  id: string;
  year: number;
  month: number;
  vvr_meta: number | null;
  vvr: number | null;
}

interface RawRow {
  id: string;
  year: number;
  month: number;
  vvr_meta: number | string | null;
  vvr: number | string | null;
}

function normalize(row: RawRow): FeeVvrRow {
  return {
    id: row.id,
    year: row.year,
    month: row.month,
    vvr_meta: row.vvr_meta === null ? null : Number(row.vvr_meta),
    vvr: row.vvr === null ? null : Number(row.vvr),
  };
}

// ─── Balanco por empresa (FEE Disponivel, FEE A Receber, Margem Media) ────
//
// `margem_media_eventos` e usado apenas por empresas do segmento Franquias
// Viva (input manual no painel FEE/VVR). A coluna existe globalmente mas
// vem NULL em empresas de outros segmentos.

interface BalanceRow {
  fee_disponivel: number | null;
  fee_a_receber: number | null;
  margem_media_eventos: number | null;
}

function normalizeBalance(row: {
  fee_disponivel: number | string | null;
  fee_a_receber: number | string | null;
  margem_media_eventos: number | string | null;
}): BalanceRow {
  return {
    fee_disponivel:
      row.fee_disponivel === null ? null : Number(row.fee_disponivel),
    fee_a_receber:
      row.fee_a_receber === null ? null : Number(row.fee_a_receber),
    margem_media_eventos:
      row.margem_media_eventos === null ? null : Number(row.margem_media_eventos),
  };
}

function parseNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * GET — Lista todos os registros mensais (VVR META / VVR) + balanco da
 * empresa (FEE Disponivel / FEE A Receber) numa unica chamada.
 *
 * Resposta: { rows: FeeVvrRow[], balance: BalanceRow }
 */
export async function GET(_request: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (!profile || profile.role !== "admin") {
    return NextResponse.json(
      { error: "Apenas admin pode acessar FEE/VVR." },
      { status: 403 },
    );
  }

  const db = createAdminClientIfAvailable() ?? supabase;

  const [monthlyResult, companyResult] = await Promise.all([
    db
      .from("company_fee_vvr")
      .select("id, year, month, vvr_meta, vvr")
      .eq("company_id", params.companyId)
      .order("year", { ascending: true })
      .order("month", { ascending: true }),
    db
      .from("companies")
      .select("fee_disponivel, fee_a_receber, margem_media_eventos")
      .eq("id", params.companyId)
      .maybeSingle<{
        fee_disponivel: number | string | null;
        fee_a_receber: number | string | null;
        margem_media_eventos: number | string | null;
      }>(),
  ]);

  if (monthlyResult.error) {
    return NextResponse.json({ error: monthlyResult.error.message }, { status: 400 });
  }
  if (companyResult.error) {
    return NextResponse.json({ error: companyResult.error.message }, { status: 400 });
  }

  const rows = (monthlyResult.data as RawRow[] | null ?? []).map(normalize);
  const balance: BalanceRow = companyResult.data
    ? normalizeBalance(companyResult.data)
    : { fee_disponivel: null, fee_a_receber: null, margem_media_eventos: null };

  return NextResponse.json({ rows, balance });
}

/**
 * POST — Upsert de uma linha mensal (year, month, vvr_meta, vvr).
 * Body: { year, month, vvr_meta?, vvr? }
 */
export async function POST(request: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (!profile || profile.role !== "admin") {
    return NextResponse.json(
      { error: "Apenas admin pode editar FEE/VVR." },
      { status: 403 },
    );
  }

  const body = (await request.json()) as {
    year?: number;
    month?: number;
    vvr_meta?: number | null;
    vvr?: number | null;
  };
  const year = Number(body.year);
  const month = Number(body.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "Ano invalido." }, { status: 400 });
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "Mes invalido (1-12)." }, { status: 400 });
  }

  const db = createAdminClientIfAvailable() ?? supabase;
  const { data, error } = await db
    .from("company_fee_vvr")
    .upsert(
      {
        company_id: params.companyId,
        year,
        month,
        vvr_meta: parseNullableNumber(body.vvr_meta),
        vvr: parseNullableNumber(body.vvr),
        updated_by: profile.id,
      },
      { onConflict: "company_id,year,month" },
    )
    .select("id, year, month, vvr_meta, vvr")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Falha ao salvar." },
      { status: 400 },
    );
  }

  return NextResponse.json({ row: normalize(data as RawRow) });
}

/**
 * PATCH — Atualiza o balanco da empresa (campos por-empresa, fora da tabela
 * mensal). Body: { fee_disponivel?, fee_a_receber? }
 * Campos ausentes nao sao tocados; null limpa o campo.
 */
export async function PATCH(request: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (!profile || profile.role !== "admin") {
    return NextResponse.json(
      { error: "Apenas admin pode editar FEE/VVR." },
      { status: 403 },
    );
  }

  const body = (await request.json()) as {
    fee_disponivel?: number | null;
    fee_a_receber?: number | null;
    margem_media_eventos?: number | null;
  };

  const update: Record<string, number | null> = {};
  if ("fee_disponivel" in body) {
    update.fee_disponivel = parseNullableNumber(body.fee_disponivel);
  }
  if ("fee_a_receber" in body) {
    update.fee_a_receber = parseNullableNumber(body.fee_a_receber);
  }
  if ("margem_media_eventos" in body) {
    update.margem_media_eventos = parseNullableNumber(body.margem_media_eventos);
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "Nenhum campo enviado para atualizacao." },
      { status: 400 },
    );
  }

  const db = createAdminClientIfAvailable() ?? supabase;
  const { data, error } = await db
    .from("companies")
    .update(update)
    .eq("id", params.companyId)
    .select("fee_disponivel, fee_a_receber, margem_media_eventos")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Falha ao salvar balanco." },
      { status: 400 },
    );
  }

  return NextResponse.json({ balance: normalizeBalance(data) });
}
