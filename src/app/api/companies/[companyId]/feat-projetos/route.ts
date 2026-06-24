import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

interface Params {
  params: {
    companyId: string;
  };
}

// ─── Controle de Projetos — exclusivo da empresa Feat Produções ─────────────
//
// CRUD por LINHA (cada projeto/evento é uma linha independente). Diferente do
// FEE/VVR (upsert por mês), aqui podem existir vários projetos no mesmo mês.
//
// Isolamento: além de exigir role admin, validamos que a empresa-alvo é de fato
// a "Feat Produções" (por nome normalizado). Nenhuma outra empresa pode gravar
// nesta área, mesmo que o endpoint seja chamado diretamente.

const TIPO_EVENTO_VALUES = ["Corporativo", "Show", "Licitação"] as const;
const FECHAMENTO_VALUES = [
  "Realizado",
  "Em aberto",
  "Evento previsto e não realizado",
] as const;

type TipoEvento = (typeof TIPO_EVENTO_VALUES)[number];
type Fechamento = (typeof FECHAMENTO_VALUES)[number];

interface ProjetoRow {
  id: string;
  year: number;
  month: number;
  projeto: string;
  tipo_evento: TipoEvento | null;
  resultado_previsto: number | null;
  resultado_realizado: number | null;
  fechamento: Fechamento | null;
}

interface RawRow {
  id: string;
  year: number;
  month: number;
  projeto: string | null;
  tipo_evento: string | null;
  resultado_previsto: number | string | null;
  resultado_realizado: number | string | null;
  fechamento: string | null;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(row: RawRow): ProjetoRow {
  return {
    id: row.id,
    year: row.year,
    month: row.month,
    projeto: row.projeto ?? "",
    tipo_evento: (row.tipo_evento as TipoEvento | null) ?? null,
    resultado_previsto:
      row.resultado_previsto === null ? null : Number(row.resultado_previsto),
    resultado_realizado:
      row.resultado_realizado === null ? null : Number(row.resultado_realizado),
    fechamento: (row.fechamento as Fechamento | null) ?? null,
  };
}

function parseNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseTipoEvento(value: unknown): TipoEvento | null {
  if (value === null || value === undefined || value === "") return null;
  return TIPO_EVENTO_VALUES.includes(value as TipoEvento)
    ? (value as TipoEvento)
    : null;
}

function parseFechamento(value: unknown): Fechamento | null {
  if (value === null || value === undefined || value === "") return null;
  return FECHAMENTO_VALUES.includes(value as Fechamento)
    ? (value as Fechamento)
    : null;
}

type Db = NonNullable<ReturnType<typeof createAdminClientIfAvailable>>;

type Guard =
  | { ok: true; db: Db; profileId: string }
  | { ok: false; response: NextResponse };

/**
 * Garante que: (1) há sessão admin e (2) a empresa-alvo é a Feat Produções.
 * Retorna o cliente de banco quando ok, ou uma resposta de erro caso contrário.
 */
async function guardFeatProducoes(companyId: string): Promise<Guard> {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Não autenticado." }, { status: 401 }),
    };
  }
  if (!profile || profile.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Apenas admin pode acessar Projetos Feat Produções." },
        { status: 403 },
      ),
    };
  }

  const db: Db = (createAdminClientIfAvailable() ?? supabase) as Db;

  const { data: company, error } = await db
    .from("companies")
    .select("name")
    .eq("id", companyId)
    .maybeSingle<{ name: string }>();

  if (error) {
    return {
      ok: false,
      response: NextResponse.json({ error: error.message }, { status: 400 }),
    };
  }
  if (!company || normalizeName(company.name) !== "feat producoes") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Recurso exclusivo da empresa Feat Produções." },
        { status: 403 },
      ),
    };
  }

  return { ok: true, db, profileId: profile.id };
}

/**
 * GET — Lista todos os projetos/eventos cadastrados da Feat Produções.
 * Resposta: { rows: ProjetoRow[] }
 */
export async function GET(_request: Request, { params }: Params) {
  const guard = await guardFeatProducoes(params.companyId);
  if (!guard.ok) return guard.response;

  const { data, error } = await guard.db
    .from("company_feat_projetos")
    .select(
      "id, year, month, projeto, tipo_evento, resultado_previsto, resultado_realizado, fechamento",
    )
    .eq("company_id", params.companyId)
    .order("year", { ascending: true })
    .order("month", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const rows = (data as RawRow[] | null ?? []).map(normalize);
  return NextResponse.json({ rows });
}

/**
 * POST — Cria um novo projeto/evento.
 * Body: { year, month, projeto, tipo_evento?, resultado_previsto?,
 *         resultado_realizado?, fechamento? }
 */
export async function POST(request: Request, { params }: Params) {
  const guard = await guardFeatProducoes(params.companyId);
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as Record<string, unknown>;
  const year = Number(body.year);
  const month = Number(body.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "Ano inválido." }, { status: 400 });
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "Mês inválido (1-12)." }, { status: 400 });
  }

  const { data, error } = await guard.db
    .from("company_feat_projetos")
    .insert({
      company_id: params.companyId,
      year,
      month,
      projeto: typeof body.projeto === "string" ? body.projeto : "",
      tipo_evento: parseTipoEvento(body.tipo_evento),
      resultado_previsto: parseNullableNumber(body.resultado_previsto),
      resultado_realizado: parseNullableNumber(body.resultado_realizado),
      fechamento: parseFechamento(body.fechamento),
      updated_by: guard.profileId,
    })
    .select(
      "id, year, month, projeto, tipo_evento, resultado_previsto, resultado_realizado, fechamento",
    )
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
 * PATCH — Atualiza um projeto/evento existente (por id).
 * Body: { id, year, month, projeto, tipo_evento?, resultado_previsto?,
 *         resultado_realizado?, fechamento? }
 */
export async function PATCH(request: Request, { params }: Params) {
  const guard = await guardFeatProducoes(params.companyId);
  if (!guard.ok) return guard.response;

  const body = (await request.json()) as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id : null;
  if (!id) {
    return NextResponse.json({ error: "id obrigatório." }, { status: 400 });
  }
  const year = Number(body.year);
  const month = Number(body.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "Ano inválido." }, { status: 400 });
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "Mês inválido (1-12)." }, { status: 400 });
  }

  const { data, error } = await guard.db
    .from("company_feat_projetos")
    .update({
      year,
      month,
      projeto: typeof body.projeto === "string" ? body.projeto : "",
      tipo_evento: parseTipoEvento(body.tipo_evento),
      resultado_previsto: parseNullableNumber(body.resultado_previsto),
      resultado_realizado: parseNullableNumber(body.resultado_realizado),
      fechamento: parseFechamento(body.fechamento),
      updated_by: guard.profileId,
    })
    .eq("id", id)
    .eq("company_id", params.companyId)
    .select(
      "id, year, month, projeto, tipo_evento, resultado_previsto, resultado_realizado, fechamento",
    )
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Falha ao atualizar." },
      { status: 400 },
    );
  }

  return NextResponse.json({ row: normalize(data as RawRow) });
}

/**
 * DELETE — Remove um projeto/evento (por id via query string ?id=...).
 */
export async function DELETE(request: Request, { params }: Params) {
  const guard = await guardFeatProducoes(params.companyId);
  if (!guard.ok) return guard.response;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id obrigatório." }, { status: 400 });
  }

  const { error } = await guard.db
    .from("company_feat_projetos")
    .delete()
    .eq("id", id)
    .eq("company_id", params.companyId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
