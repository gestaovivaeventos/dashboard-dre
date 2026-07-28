import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

import { normalizeCompanyName } from "./templates/hero-holding-template";

// ============================================================================
// Quadro de MÚTUOS — segmento Franquias Viva.
// ============================================================================
// Os valores são de REGISTRO MANUAL, preenchidos pelo admin no painel "Mútuos"
// de Configurações > Empresas (colunas `mutuo_principal`, `mutuo_amortizado` e
// `mutuo_saldo_devedor` em `companies`). Este módulo apenas LÊ e monta o quadro
// exibido no relatório de Business Intelligence — não calcula nada a partir do
// DRE, Fluxo de Caixa ou Omie.
//
// Dois escopos, ambos configurados pelo template da empresa:
//
//   scope "holding"  → Hero Holding: uma linha por unidade Viva listada em
//                      `companyNames`, na ordem dada.
//   scope "company"  → demais Franquias Viva: uma única linha, da própria
//                      empresa analisada.
//
// REGRA DE EXIBIÇÃO (vale para os dois escopos): saldo devedor nulo, zero ou
// negativo significa "sem mútuo em aberto" — a linha é OMITIDA. Se nenhuma linha
// sobra, o builder devolve `undefined` e o quadro não aparece no relatório.
// ============================================================================

export interface MutuoRowResult {
  empresa: string;
  principal: number | null;
  amortizado: number | null;
  saldoDevedor: number;
}

export interface MutuosResult {
  /** ReportBlockKey p/ gating ("mutuos"). */
  key: string;
  title: string;
  scope: "holding" | "company";
  rows: MutuoRowResult[];
}

interface CompanyMutuoRow {
  id: string;
  name: string;
  mutuo_principal: number | string | null;
  mutuo_amortizado: number | string | null;
  mutuo_saldo_devedor: number | string | null;
}

const MUTUO_SELECT =
  "id,name,mutuo_principal,mutuo_amortizado,mutuo_saldo_devedor";

const num = (v: number | string | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

/** Converte uma empresa em linha do quadro, ou null quando não há mútuo aberto. */
function toRow(company: CompanyMutuoRow): MutuoRowResult | null {
  const saldoDevedor = num(company.mutuo_saldo_devedor);
  // Sem saldo devedor preenchido (ou zerado) = sem dívida de mútuo em aberto.
  if (saldoDevedor === null || !Number.isFinite(saldoDevedor) || saldoDevedor <= 0) {
    return null;
  }
  return {
    empresa: company.name,
    principal: num(company.mutuo_principal),
    amortizado: num(company.mutuo_amortizado),
    saldoDevedor,
  };
}

interface BuildMutuosArgs {
  key: string;
  title: string;
  scope: "holding" | "company";
  /** Escopo "company": empresa analisada. */
  companyId: string;
  /** Escopo "holding": nomes das unidades do grupo, NA ORDEM de exibição. */
  companyNames?: string[];
}

/**
 * Monta o quadro de mútuos. Devolve `undefined` quando nenhuma empresa do
 * escopo tem saldo devedor em aberto (o relatório então não exibe o quadro).
 *
 * Usa o admin client para leitura (quando disponível) pelo mesmo motivo do
 * comparativo da holding: os dados de mútuo são geridos no painel admin, e o
 * gerador do relatório da holding não tem, necessariamente, acesso individual a
 * cada unidade. É estritamente LEITURA; não escreve nada.
 */
export async function buildMutuosBlock(
  supabase: SupabaseClient,
  args: BuildMutuosArgs,
): Promise<MutuosResult | undefined> {
  const { key, title, scope, companyId, companyNames } = args;
  const db = createAdminClientIfAvailable() ?? supabase;

  // ── Escopo "company": apenas a empresa analisada ────────────────────────────
  if (scope === "company") {
    const { data } = await db
      .from("companies")
      .select(MUTUO_SELECT)
      .eq("id", companyId)
      .maybeSingle<CompanyMutuoRow>();
    const row = data ? toRow(data) : null;
    if (!row) return undefined;
    return { key, title, scope, rows: [row] };
  }

  // ── Escopo "holding": as unidades listadas, na ordem configurada ────────────
  const names = companyNames ?? [];
  if (names.length === 0) return undefined;

  // Restringe ao segmento franquias-viva (garante que só entram unidades Viva),
  // igual ao comparativo da holding.
  const { data: seg } = await db
    .from("segments")
    .select("id")
    .eq("slug", "franquias-viva")
    .maybeSingle<{ id: string }>();

  const wanted = new Map<string, number>(); // nome normalizado → índice de ordem
  names.forEach((n, i) => wanted.set(normalizeCompanyName(n), i));

  let query = db.from("companies").select(MUTUO_SELECT);
  if (seg?.id) query = query.eq("segment_id", seg.id);
  const { data: companyRows } = await query;

  const matched: Array<{ order: number; row: MutuoRowResult }> = [];
  ((companyRows ?? []) as CompanyMutuoRow[]).forEach((c) => {
    const order = wanted.get(normalizeCompanyName(c.name));
    if (order === undefined) return;
    const row = toRow(c);
    if (row) matched.push({ order, row });
  });
  matched.sort((a, b) => a.order - b.order);

  if (matched.length === 0) return undefined;
  return { key, title, scope, rows: matched.map((m) => m.row) };
}
