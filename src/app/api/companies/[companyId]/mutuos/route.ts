import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

interface Params {
  params: {
    companyId: string;
  };
}

// ─── Mutuo por empresa (um unico registro por unidade) ────────────────────────
//
// Os tres valores sao preenchidos MANUALMENTE pelo admin no painel "Mutuos" de
// Configuracoes > Empresas (exclusivo do segmento Franquias Viva). Mesmo padrao
// do balanco do painel FEE / VVR: colunas na propria tabela `companies`.
//
// Saldo devedor nulo/zero = unidade SEM mutuo em aberto (a regra de exibicao no
// relatorio de BI vive em `src/lib/financeiro/relatorios/mutuos.ts`).

interface MutuoRow {
  mutuo_principal: number | null;
  mutuo_amortizado: number | null;
  mutuo_saldo_devedor: number | null;
}

const MUTUO_SELECT =
  "mutuo_principal, mutuo_amortizado, mutuo_saldo_devedor";

type MutuoField = keyof MutuoRow;

const MUTUO_FIELDS: MutuoField[] = [
  "mutuo_principal",
  "mutuo_amortizado",
  "mutuo_saldo_devedor",
];

function normalizeMutuo(row: {
  mutuo_principal: number | string | null;
  mutuo_amortizado: number | string | null;
  mutuo_saldo_devedor: number | string | null;
}): MutuoRow {
  return {
    mutuo_principal:
      row.mutuo_principal === null ? null : Number(row.mutuo_principal),
    mutuo_amortizado:
      row.mutuo_amortizado === null ? null : Number(row.mutuo_amortizado),
    mutuo_saldo_devedor:
      row.mutuo_saldo_devedor === null ? null : Number(row.mutuo_saldo_devedor),
  };
}

const EMPTY_MUTUO: MutuoRow = {
  mutuo_principal: null,
  mutuo_amortizado: null,
  mutuo_saldo_devedor: null,
};

function parseNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * GET — Situacao de mutuo da empresa.
 * Resposta: { mutuo: MutuoRow }
 */
export async function GET(_request: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (!profile || profile.role !== "admin") {
    return NextResponse.json(
      { error: "Apenas admin pode acessar Mutuos." },
      { status: 403 },
    );
  }

  const db = createAdminClientIfAvailable() ?? supabase;
  const { data, error } = await db
    .from("companies")
    .select(MUTUO_SELECT)
    .eq("id", params.companyId)
    .maybeSingle<{
      mutuo_principal: number | string | null;
      mutuo_amortizado: number | string | null;
      mutuo_saldo_devedor: number | string | null;
    }>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    mutuo: data ? normalizeMutuo(data) : EMPTY_MUTUO,
  });
}

/**
 * PATCH — Atualiza um ou mais campos do mutuo.
 * Body: { mutuo_principal?, mutuo_amortizado?, mutuo_saldo_devedor? }
 * Campos ausentes nao sao tocados; null limpa o campo.
 */
export async function PATCH(request: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (!profile || profile.role !== "admin") {
    return NextResponse.json(
      { error: "Apenas admin pode editar Mutuos." },
      { status: 403 },
    );
  }

  const body = (await request.json()) as Partial<
    Record<MutuoField, number | null>
  >;

  const update: Record<string, number | null> = {};
  for (const field of MUTUO_FIELDS) {
    if (field in body) update[field] = parseNullableNumber(body[field]);
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
    .select(MUTUO_SELECT)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Falha ao salvar mutuo." },
      { status: 400 },
    );
  }

  return NextResponse.json({ mutuo: normalizeMutuo(data) });
}
