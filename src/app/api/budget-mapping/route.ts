import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { reprocessBudgetEntriesForCompany } from "@/lib/budget/reprocess";
import {
  SCOPED_DRE_ACCOUNTS_SELECT,
  fetchAllDreAccountRows,
  scopeDreAccounts,
  type RawDreAccount,
} from "@/lib/dashboard/dre";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

interface BudgetMappingRow {
  id: string;
  label: string;
  dreAccountId: string | null;
  dreAccountCode: string | null;
  dreAccountName: string | null;
  rowsCount: number;
}

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarityScore(a: string, b: string): number {
  // Token-overlap score: count of shared tokens normalized by the larger set.
  const ta = new Set(a.split(/\s+/).filter((t) => t.length >= 3));
  const tb = new Set(b.split(/\s+/).filter((t) => t.length >= 3));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  ta.forEach((t) => {
    if (tb.has(t)) shared += 1;
  });
  return shared / Math.max(ta.size, tb.size);
}

export async function GET(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const url = new URL(request.url);
  const companyId = url.searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "Informe companyId." }, { status: 400 });
  }

  const [
    { data: mappings, error: mappingsErr },
    { data: rawCounts, error: rawErr },
    { data: companyOmieMappings, error: companyOmieErr },
    allAccounts,
  ] = await Promise.all([
    supabase
      .from("budget_account_mappings")
      .select("id,label,dre_account_id")
      .eq("company_id", companyId),
    supabase
      .from("budget_uploads_raw")
      .select("label")
      .eq("company_id", companyId),
    // Contas DRE que esta empresa USA (via mapeamento Omie/DRE)
    supabase
      .from("category_mapping")
      .select("dre_account_id")
      .eq("company_id", companyId)
      .not("dre_account_id", "is", null),
    // ESCOPADO ao plano da empresa (custom) + global. Antes carregava TODAS as
    // contas de TODAS as empresas, o que fazia a sugestao automatica casar um
    // label (ex.: "Despesas Administrativas") com a conta de MESMO NOME de OUTRA
    // empresa. Como o Budget traduz a conta por CODIGO, o valor caia na conta de
    // mesmo code da empresa atual (ex.: code 7.1 = "Despesas Administrativas" em
    // outra empresa vs. "Despesas de Vendas e Marketing" na SGX) — gerando
    // valores fantasma. Paginado por causa do cap de 1000 do PostgREST.
    fetchAllDreAccountRows<RawDreAccount>((from, to) =>
      supabase
        .from("dre_accounts")
        .select(SCOPED_DRE_ACCOUNTS_SELECT)
        .eq("active", true)
        .or(`company_id.is.null,company_id.eq.${companyId}`)
        .order("code")
        .range(from, to),
    ),
  ]);

  if (mappingsErr) return NextResponse.json({ error: mappingsErr.message }, { status: 400 });
  if (rawErr) return NextResponse.json({ error: rawErr.message }, { status: 400 });
  if (companyOmieErr) return NextResponse.json({ error: companyOmieErr.message }, { status: 400 });

  const labelCounts = new Map<string, number>();
  ((rawCounts ?? []) as Array<{ label: string }>).forEach((row) => {
    labelCounts.set(row.label, (labelCounts.get(row.label) ?? 0) + 1);
  });

  // Aplica o MESMO escopo do dropdown do cliente (plano custom da empresa OU
  // global) para montar tanto o lookup de exibicao quanto o pool de sugestoes.
  const scope = scopeDreAccounts(allAccounts, [companyId]);
  const scopedAccounts = scope.scopedAccounts;
  const accountById = new Map(scopedAccounts.map((a) => [a.id, a]));

  // Set de contas DRE que esta empresa "usa": tudo que ja foi referenciado nos
  // mapeamentos Omie/DRE da empresa ou em mapeamentos de orcamento ja salvos.
  const companyAccountIdSet = new Set<string>();
  ((companyOmieMappings ?? []) as Array<{ dre_account_id: string | null }>).forEach((row) => {
    if (row.dre_account_id) companyAccountIdSet.add(row.dre_account_id);
  });
  ((mappings ?? []) as Array<{ dre_account_id: string | null }>).forEach((row) => {
    if (row.dre_account_id) companyAccountIdSet.add(row.dre_account_id);
  });
  const companyAccountIds = Array.from(companyAccountIdSet);

  const rows: BudgetMappingRow[] = ((mappings ?? []) as Array<{
    id: string;
    label: string;
    dre_account_id: string | null;
  }>)
    .map((row) => {
      const account = row.dre_account_id ? accountById.get(row.dre_account_id) : null;
      return {
        id: row.id,
        label: row.label,
        dreAccountId: row.dre_account_id,
        dreAccountCode: account?.code ?? null,
        dreAccountName: account?.name ?? null,
        rowsCount: labelCounts.get(row.label) ?? 0,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

  // Sugestoes de mapeamento (apenas para labels sem mapping ainda).
  // Estrategia: comparar o label normalizado contra o nome de cada conta DRE,
  // priorizando contas que a empresa ja usa. Aceita o melhor match acima de
  // um limiar minimo de similaridade.
  const SIMILARITY_THRESHOLD = 0.5;
  const accountsForMatching = scopedAccounts as Array<{ id: string; code: string; name: string }>;
  const suggestions: Record<string, { dreAccountId: string; dreAccountCode: string; dreAccountName: string }> = {};

  rows.forEach((row) => {
    if (row.dreAccountId) return; // already mapped
    const labelNorm = normalizeForMatch(row.label);
    let bestId: string | null = null;
    let bestScore = 0;
    let bestIsCompanyOwned = false;
    for (const account of accountsForMatching) {
      const nameNorm = normalizeForMatch(account.name);
      // Exact-equal normalized name wins immediately
      let score = similarityScore(labelNorm, nameNorm);
      if (labelNorm === nameNorm) score = 1.5;
      else if (nameNorm.includes(labelNorm) || labelNorm.includes(nameNorm)) score = Math.max(score, 0.85);

      if (score < SIMILARITY_THRESHOLD) continue;
      const isOwned = companyAccountIdSet.has(account.id);
      // Prefer accounts the company already uses on ties / near-ties.
      const adjustedScore = score + (isOwned ? 0.1 : 0);
      if (adjustedScore > bestScore || (adjustedScore === bestScore && isOwned && !bestIsCompanyOwned)) {
        bestScore = adjustedScore;
        bestId = account.id;
        bestIsCompanyOwned = isOwned;
      }
    }
    if (bestId) {
      const acc = accountById.get(bestId);
      if (acc) {
        suggestions[row.label] = {
          dreAccountId: bestId,
          dreAccountCode: acc.code,
          dreAccountName: acc.name,
        };
      }
    }
  });

  return NextResponse.json({ rows, companyAccountIds, suggestions });
}

export async function POST(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const body = (await request.json()) as {
    companyId?: string;
    mappings?: Array<{ label: string; dreAccountId: string | null }>;
  };

  const companyId = body.companyId?.trim();
  const mappings = body.mappings ?? [];
  if (!companyId) {
    return NextResponse.json({ error: "Informe companyId." }, { status: 400 });
  }

  const db = createAdminClientIfAvailable() ?? supabase;

  const { data: company, error: companyErr } = await db
    .from("companies")
    .select("id")
    .eq("id", companyId)
    .single();
  if (companyErr || !company) {
    return NextResponse.json({ error: "Empresa nao encontrada." }, { status: 404 });
  }

  // Valida que cada conta pertence ao plano da empresa (custom) OU ao global.
  // Bloquear contas de OUTRA empresa e essencial: como o Budget traduz a conta
  // por CODIGO, mapear para a conta de mesmo code de outra empresa jogaria o
  // valor na conta errada da empresa atual (bug dos valores fantasma).
  const accountIds = Array.from(
    new Set(mappings.map((m) => m.dreAccountId).filter((id): id is string => Boolean(id))),
  );
  if (accountIds.length > 0) {
    const scopedRaw = await fetchAllDreAccountRows<RawDreAccount>((from, to) =>
      db
        .from("dre_accounts")
        .select(SCOPED_DRE_ACCOUNTS_SELECT)
        .eq("active", true)
        .or(`company_id.is.null,company_id.eq.${companyId}`)
        .order("code")
        .range(from, to),
    );
    const validSet = new Set(
      scopeDreAccounts(scopedRaw, [companyId]).scopedAccounts.map((a) => a.id),
    );
    for (const m of mappings) {
      if (m.dreAccountId && !validSet.has(m.dreAccountId)) {
        return NextResponse.json(
          { error: `Conta DRE fora do plano da empresa: ${m.dreAccountId}` },
          { status: 400 },
        );
      }
    }
  }

  // Upsert mappings (one row per label)
  let saved = 0;
  let cleared = 0;
  for (const mapping of mappings) {
    const label = mapping.label?.trim();
    if (!label) continue;
    const dreAccountId = mapping.dreAccountId ?? null;
    if (dreAccountId === null) cleared += 1;
    else saved += 1;

    const { error: upsertErr } = await db
      .from("budget_account_mappings")
      .upsert(
        {
          company_id: companyId,
          label,
          dre_account_id: dreAccountId,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id,label" },
      );
    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 400 });
    }
  }

  // Re-apply mappings to budget_entries for all years that have raw uploads
  let reprocessed: { imported: number; unmappedLabels: string[] };
  try {
    reprocessed = await reprocessBudgetEntriesForCompany(db, companyId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    saved,
    cleared,
    imported: reprocessed.imported,
    unmappedLabels: reprocessed.unmappedLabels,
  });
}
