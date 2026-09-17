import "server-only";

import { todayBR } from "@/lib/ctrl/datetime";
import {
  fetchOmieSaldo,
  listOmieContasCorrentes,
  newOmieClock,
} from "@/lib/caixa/omie";
import type { CaixaCompanyResult } from "@/lib/caixa/types";
import { decryptSecret } from "@/lib/security/encryption";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface CaixaCompany {
  id: string;
  name: string;
  appKey: string;
  appSecret: string;
}

/**
 * Empresas que entram no Caixa: ativas E com credencial Omie.
 *
 * `sync_enabled` é ignorado de propósito — aquela flag decide se a unidade
 * entra no ciclo do DRE/BI, e uma unidade fora do pacote de relatórios continua
 * tendo dinheiro em conta. O Caixa responde "quanto o grupo tem agora", então
 * ficar de fora teria que ser uma decisão sobre caixa, não sobre relatório.
 */
export async function listCaixaCompanies(admin: AdminClient): Promise<CaixaCompany[]> {
  const { data, error } = await admin
    .from("companies")
    .select("id,name,omie_app_key,omie_app_secret")
    .eq("active", true)
    .order("name");
  if (error) throw new Error(error.message);

  const out: CaixaCompany[] = [];
  for (const row of data ?? []) {
    const key = row.omie_app_key as string | null;
    const secret = row.omie_app_secret as string | null;
    if (!key || !secret) continue;
    try {
      out.push({
        id: row.id as string,
        name: (row.name as string) ?? "",
        appKey: decryptSecret(key),
        appSecret: decryptSecret(secret),
      });
    } catch {
      // Credencial ilegível (ENCRYPTION_KEY trocada) — a empresa sai da
      // varredura em vez de derrubá-la. Aparece como erro no run.
    }
  }
  return out;
}

/**
 * Só id e nome das empresas do Caixa — sem descriptografar credencial. É o que
 * a tela consome para varrer empresa a empresa mostrando progresso.
 */
export async function listCaixaCompanyRefs(
  admin: AdminClient,
): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await admin
    .from("companies")
    .select("id,name,omie_app_key,omie_app_secret")
    .eq("active", true)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((row) => row.omie_app_key && row.omie_app_secret)
    .map((row) => ({ id: row.id as string, name: (row.name as string) ?? "" }));
}

// ── Cadastro ───────────────────────────────────────────────────────────────

/**
 * Espelha o cadastro de contas correntes de UMA empresa.
 *
 * Conta que sumiu da Omie vira `ativo = false`; nunca é apagada, porque os
 * snapshots de saldo dela continuam sendo fatos e o histórico não deve sumir
 * junto com um cadastro encerrado.
 */
export async function syncCompanyAccounts(
  admin: AdminClient,
  company: CaixaCompany,
): Promise<CaixaCompanyResult> {
  const base = { companyId: company.id, companyName: company.name };
  try {
    const clock = newOmieClock();
    const contas = await listOmieContasCorrentes(company.appKey, company.appSecret, clock);

    if (contas.length > 0) {
      const now = new Date().toISOString();
      const { error } = await admin.from("caixa_accounts").upsert(
        contas.map((c) => ({
          company_id: company.id,
          omie_cc_id: c.omieCcId,
          descricao: c.descricao,
          tipo: c.tipo,
          banco_codigo: c.bancoCodigo,
          agencia: c.agencia,
          conta: c.conta,
          ativo: c.ativo,
          last_seen_at: now,
          updated_at: now,
        })),
        { onConflict: "company_id,omie_cc_id" },
      );
      if (error) throw new Error(error.message);
    }

    // Some da Omie → inativa aqui. Só mexe em quem ainda está marcada ativa,
    // para não reescrever a tabela inteira a cada varredura.
    const vistos = contas.map((c) => c.omieCcId);
    if (vistos.length > 0) {
      await admin
        .from("caixa_accounts")
        .update({ ativo: false, updated_at: new Date().toISOString() })
        .eq("company_id", company.id)
        .eq("ativo", true)
        .not("omie_cc_id", "in", `(${vistos.map((v) => `"${v}"`).join(",")})`);
    }

    return { ...base, ok: true, accountsOk: contas.length, accountsError: 0, error: null };
  } catch (err) {
    return { ...base, ok: false, accountsOk: 0, accountsError: 0, error: msg(err) };
  }
}

// ── Saldos ─────────────────────────────────────────────────────────────────

/**
 * Atualiza o saldo de todas as contas ATIVAS de uma empresa.
 *
 * Uma conta que falha não derruba as outras: grava `saldo_error` na linha,
 * mantém o saldo anterior e segue. A tela mostra o erro junto do número velho
 * — saldo velho sem aviso é pior que saldo nenhum.
 */
export async function refreshCompanyBalances(
  admin: AdminClient,
  company: CaixaCompany,
  source: "cron" | "manual",
): Promise<CaixaCompanyResult> {
  const base = { companyId: company.id, companyName: company.name };
  try {
    const { data, error } = await admin
      .from("caixa_accounts")
      .select("id,omie_cc_id")
      .eq("company_id", company.id)
      .eq("ativo", true);
    if (error) throw new Error(error.message);

    const accounts = (data ?? []) as Array<{ id: string; omie_cc_id: string }>;
    if (accounts.length === 0) {
      return { ...base, ok: true, accountsOk: 0, accountsError: 0, error: null };
    }

    const clock = newOmieClock();
    const hoje = todayBR();
    const snapshots: Array<Record<string, unknown>> = [];
    let ok = 0;
    let failed = 0;

    for (const account of accounts) {
      try {
        const saldo = await fetchOmieSaldo(
          company.appKey,
          company.appSecret,
          account.omie_cc_id,
          hoje,
          clock,
        );
        if (!saldo) {
          // Conta sem movimento na Omie: não é erro, mas não temos número
          // confirmado. Limpa o erro anterior e não grava snapshot.
          await admin
            .from("caixa_accounts")
            .update({ saldo_error: null, updated_at: new Date().toISOString() })
            .eq("id", account.id);
          ok += 1;
          continue;
        }

        const now = new Date().toISOString();
        await admin
          .from("caixa_accounts")
          .update({ saldo: saldo.saldo, saldo_at: now, saldo_error: null, updated_at: now })
          .eq("id", account.id);

        snapshots.push({
          account_id: account.id,
          captured_at: now,
          captured_day: hoje,
          saldo: saldo.saldo,
          saldo_disponivel: saldo.saldoDisponivel,
          saldo_conciliado: saldo.saldoConciliado,
          source,
        });
        ok += 1;
      } catch (err) {
        failed += 1;
        await admin
          .from("caixa_accounts")
          .update({ saldo_error: msg(err), updated_at: new Date().toISOString() })
          .eq("id", account.id);
      }
    }

    if (snapshots.length > 0) {
      await admin.from("caixa_balance_snapshots").insert(snapshots);
    }

    return {
      ...base,
      ok: failed === 0,
      accountsOk: ok,
      accountsError: failed,
      error: failed > 0 ? `${failed} conta(s) falharam` : null,
    };
  } catch (err) {
    return { ...base, ok: false, accountsOk: 0, accountsError: 0, error: msg(err) };
  }
}

// ── Varredura do grupo inteiro (cron) ──────────────────────────────────────

/**
 * Quantas empresas processam ao mesmo tempo.
 *
 * Cada empresa é uma conta Omie distinta (app_key própria) e tem o seu próprio
 * relógio de rate-limit, então o paralelismo não aproxima nenhuma delas do
 * limite. É o que mantém a varredura dentro dos 300s da Vercel.
 *
 * Números reais da primeira carga (17/09/2026): 272 contas ativas em 26
 * empresas, ~2,4s por conta → ~650s serializado. Com 5 em paralelo deu 121s
 * medidos; 8 deixa a margem confortável (~75s) para o dia em que o grupo
 * crescer ou a Omie estiver lenta. Serializar de volta estoura o teto.
 */
const SWEEP_CONCURRENCY = Math.max(
  1,
  Number(process.env.CAIXA_SWEEP_CONCURRENCY ?? "8") || 8,
);

export interface CaixaSweepResult {
  runId: string | null;
  results: CaixaCompanyResult[];
}

export async function runCaixaSweep(
  admin: AdminClient,
  opts: {
    kind: "cadastro" | "saldos";
    trigger: "cron" | "manual";
    startedBy?: string | null;
    /** Quando presente, varre só estas empresas. */
    companyIds?: string[];
  },
): Promise<CaixaSweepResult> {
  let companies = await listCaixaCompanies(admin);
  if (opts.companyIds?.length) {
    const wanted = new Set(opts.companyIds);
    companies = companies.filter((c) => wanted.has(c.id));
  }

  const { data: runRow } = await admin
    .from("caixa_sync_runs")
    .insert({
      kind: opts.kind,
      trigger: opts.trigger,
      companies_total: companies.length,
      started_by: opts.startedBy ?? null,
    })
    .select("id")
    .maybeSingle();
  const runId = (runRow?.id as string | undefined) ?? null;

  const results: CaixaCompanyResult[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(SWEEP_CONCURRENCY, companies.length) }, async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= companies.length) break;
        const company = companies[index];
        results.push(
          opts.kind === "cadastro"
            ? await syncCompanyAccounts(admin, company)
            : await refreshCompanyBalances(admin, company, opts.trigger),
        );
      }
    }),
  );

  if (runId) {
    await admin
      .from("caixa_sync_runs")
      .update({
        finished_at: new Date().toISOString(),
        companies_ok: results.filter((r) => r.ok).length,
        accounts_ok: results.reduce((s, r) => s + r.accountsOk, 0),
        accounts_error: results.reduce((s, r) => s + r.accountsError, 0),
        errors: results
          .filter((r) => r.error)
          .map((r) => ({ company_id: r.companyId, company_name: r.companyName, error: r.error })),
      })
      .eq("id", runId);
  }

  return { runId, results };
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
