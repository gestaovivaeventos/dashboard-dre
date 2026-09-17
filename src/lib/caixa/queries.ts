// Leituras do módulo Caixa. Recebem o client (do usuário → RLS; admin →
// service role) para que páginas e rotas escolham o contexto.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { todayBR } from "@/lib/ctrl/datetime";
import type { CaixaAccountRow } from "@/lib/caixa/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CaixaDb = SupabaseClient<any>;

/**
 * Quantos dias para trás procuramos o saldo de referência da "variação no dia".
 * Cobre feriado prolongado sem varrer a tabela inteira; além disso, a variação
 * vira null (honesto) em vez de comparar com um saldo de um mês atrás.
 */
const VARIATION_LOOKBACK_DAYS = 10;

/**
 * Todas as contas com o saldo corrente e a variação no dia.
 *
 * "Variação no dia" é o saldo de agora menos o último saldo capturado ANTES de
 * hoje (Brasília) — não "desde a captura anterior". Com duas capturas por dia,
 * comparar com a anterior mostraria meio dia às 12:30, o que não é a pergunta
 * que alguém faz olhando a coluna.
 *
 * Contas inativas ficam de fora por padrão: são cadastros encerrados na Omie,
 * e o saldo delas não é mais atualizado.
 */
export async function listCaixaAccounts(
  db: CaixaDb,
  opts: { includeInactive?: boolean } = {},
): Promise<CaixaAccountRow[]> {
  let query = db
    .from("caixa_accounts")
    .select(
      "id,company_id,omie_cc_id,descricao,tipo,banco_codigo,agencia,conta,ativo,saldo,saldo_at,saldo_error,companies(name)",
    )
    .order("descricao");
  if (!opts.includeInactive) query = query.eq("ativo", true);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const previous = await previousDayBalances(
    db,
    rows.map((r) => r.id as string),
  );

  return rows.map((row) => {
    const id = row.id as string;
    const saldo = numOrNull(row.saldo);
    const anterior = previous.get(id);
    return {
      id,
      companyId: row.company_id as string,
      companyName: resolveCompanyName(row.companies),
      omieCcId: row.omie_cc_id as string,
      descricao: (row.descricao as string) ?? "",
      tipo: (row.tipo as string | null) ?? null,
      bancoCodigo: (row.banco_codigo as string | null) ?? null,
      agencia: (row.agencia as string | null) ?? null,
      conta: (row.conta as string | null) ?? null,
      ativo: Boolean(row.ativo),
      saldo,
      saldoAt: (row.saldo_at as string | null) ?? null,
      saldoError: (row.saldo_error as string | null) ?? null,
      variacaoDia:
        saldo !== null && anterior !== undefined ? round2(saldo - anterior) : null,
    };
  });
}

/**
 * Último saldo capturado antes de hoje, por conta. Percorre os snapshots do
 * mais recente para o mais antigo e fica com o primeiro de cada conta.
 */
async function previousDayBalances(
  db: CaixaDb,
  accountIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (accountIds.length === 0) return out;

  const hoje = todayBR();
  const desde = shiftDays(hoje, -VARIATION_LOOKBACK_DAYS);

  const { data, error } = await db
    .from("caixa_balance_snapshots")
    .select("account_id,saldo,captured_at")
    .lt("captured_day", hoje)
    .gte("captured_day", desde)
    .order("captured_at", { ascending: false });
  // A variação é enfeite: falha aqui não pode derrubar a tela do saldo.
  if (error) return out;

  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const id = row.account_id as string;
    if (out.has(id)) continue; // já pegamos o mais recente desta conta
    const saldo = numOrNull(row.saldo);
    if (saldo !== null) out.set(id, saldo);
  }
  return out;
}

/** Quando o saldo foi atualizado pela última vez (o mais recente de todos). */
export async function lastCaixaUpdate(db: CaixaDb): Promise<string | null> {
  const { data, error } = await db
    .from("caixa_accounts")
    .select("saldo_at")
    .not("saldo_at", "is", null)
    .order("saldo_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data?.saldo_at as string | null) ?? null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** 'YYYY-MM-DD' + N dias, em UTC puro (a data já veio resolvida em Brasília). */
function shiftDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** O embed do PostgREST vem como objeto ou array de um item, conforme a FK. */
function resolveCompanyName(v: unknown): string {
  if (!v) return "";
  const row = Array.isArray(v) ? v[0] : v;
  return (row as { name?: string } | undefined)?.name ?? "";
}
