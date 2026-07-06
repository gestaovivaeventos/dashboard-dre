import { NextResponse } from "next/server";

import {
  sendSyncFailureEmail,
  sendUnmappedCategoriesEmail,
  sendUnmappedEntriesAlertEmail,
} from "@/lib/notifications/resend";
import { runCompanySyncAsSystem } from "@/lib/omie/sync";
import { syncCaseCadastrosFromOmie } from "@/lib/case/sync-cadastros";
import { syncCasePagamentosFromOmie } from "@/lib/case/sync-pagamentos";
import { syncFeatSheetsToManualValues } from "@/lib/sheets/feat-sync";
import { syncTerrazzoSheetsToManualValues } from "@/lib/sheets/terrazzo-sync";
import { syncSirenaSheetsToManualValues } from "@/lib/sheets/sirena-sync";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

// Quantas empresas sincronizam em paralelo. Antes o cron processava todas
// em serie dentro de uma unica invocacao de 300s; conforme o volume cresceu,
// o tempo total passou de 5 min e a Vercel matava a funcao no meio do loop —
// as empresas no fim da ordem alfabetica (Terrazzo, Viva *) deixavam de
// sincronizar silenciosamente (sem erro no sync_log, sem e-mail de alerta).
// Rodar em pool concorrente divide o tempo total por ~CONCURRENCY. E seguro:
// runCompanySyncAsSystem e autocontido (client + throttle proprios) e cada
// empresa usa credenciais Omie distintas (rate-limit por app_key).
// Ajustavel via env; este e o hotfix ate o fan-out definitivo (1 invocacao
// por empresa), que remove de vez o teto compartilhado de 300s.
const SYNC_CONCURRENCY = Math.max(
  1,
  Number(process.env.SYNC_CONCURRENCY ?? "4") || 4,
);

// Pool de concorrencia: N workers consomem a fila de itens ate esvaziar.
// Mantem no maximo `limit` execucoes simultaneas.
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) break;
        await worker(items[index], index);
      }
    },
  );
  await Promise.all(runners);
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: companies, error: companiesError } = await supabase
    .from("companies")
    .select("id,name,active")
    .eq("active", true)
    .order("name");

  if (companiesError) {
    return NextResponse.json({ error: companiesError.message }, { status: 400 });
  }

  const failures: Array<{ companyId: string; companyName: string; error: string }> = [];
  const unmappedCategories: Array<{
    companyId: string;
    companyName: string;
    code: string;
    description: string;
  }> = [];
  const results: Array<{
    companyId: string;
    companyName: string;
    ok: boolean;
    recordsImported: number;
    categoriesUnmapped: number;
    error?: string;
  }> = [];

  // Empresas rodam em pool concorrente (ver SYNC_CONCURRENCY). Os push em
  // failures/unmappedCategories/results sao seguros: o event loop do Node e
  // single-thread, entao nao ha escrita concorrente real nos arrays — cada
  // worker so toca os arrays entre awaits.
  await runWithConcurrency(companies ?? [], SYNC_CONCURRENCY, async (company) => {
    const companyId = company.id as string;
    const companyName = company.name as string;

    try {
      const result = await runCompanySyncAsSystem(companyId, "rolling");
      result.newUnmappedCategories.forEach((category) => {
        unmappedCategories.push({
          companyId,
          companyName,
          code: category.code,
          description: category.description,
        });
      });
      results.push({
        companyId,
        companyName,
        ok: true,
        recordsImported: result.recordsImported,
        categoriesUnmapped: result.newUnmappedCategories.length,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha inesperada na sincronizacao.";
      failures.push({ companyId, companyName, error: message });
      results.push({
        companyId,
        companyName,
        ok: false,
        recordsImported: 0,
        categoriesUnmapped: 0,
        error: message,
      });
    }
  });

  // Auditoria de lancamentos invisiveis no dashboard apos os syncs:
  // varre os ultimos 90 dias de TODAS as empresas ativas. Se aparecer
  // qualquer entry com categoria sem mapeamento DRE, alerta o admin.
  // Esta e a defesa principal contra o sintoma "drilldown != dashboard"
  // — entries sem mapping ficam fora da agregacao da DRE silenciosamente.
  const allCompanyIds = (companies ?? []).map((c) => c.id as string);
  const today = new Date();
  const since = new Date(today);
  since.setDate(since.getDate() - 90);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  let unmappedEntries: Array<{
    companyName: string;
    categoryCode: string;
    categoryName: string;
    entryCount: number;
    totalValue: number;
    oldestPayment: string;
    newestPayment: string;
  }> = [];

  if (allCompanyIds.length > 0) {
    const { data: auditData, error: auditError } = await supabase.rpc(
      "dashboard_dre_unmapped_entries_audit",
      {
        p_company_ids: allCompanyIds,
        p_date_from: fmt(since),
        p_date_to: fmt(today),
      },
    );
    if (!auditError && Array.isArray(auditData)) {
      unmappedEntries = auditData.map((row) => ({
        companyName: String(row.company_name ?? ""),
        categoryCode: String(row.category_code ?? ""),
        categoryName: String(row.category_name ?? ""),
        entryCount: Number(row.entry_count ?? 0),
        totalValue: Number(row.total_value ?? 0),
        oldestPayment: String(row.oldest_payment ?? ""),
        newestPayment: String(row.newest_payment ?? ""),
      }));
    }
  }

  // Sincroniza planilha Google Sheets da Feat Producoes (receitas/impostos
  // por evento). Roda apos os syncs do Omie — falha aqui nao impede o
  // restante. So executa se as env vars estiverem configuradas.
  let featSheetsSync: {
    ok: boolean;
    rowsRead?: number;
    periodsUpserted?: number;
    error?: string;
  } | null = null;
  if (process.env.FEAT_PRODUCOES_SHEET_ID && process.env.FEAT_PRODUCOES_SHEET_TAB) {
    try {
      const result = await syncFeatSheetsToManualValues();
      featSheetsSync = {
        ok: true,
        rowsRead: result.rowsRead,
        periodsUpserted: result.periodsUpserted,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha desconhecida no sync da planilha Feat.";
      featSheetsSync = { ok: false, error: message };
      failures.push({
        companyId: "feat-sheets",
        companyName: "Feat Producoes (planilha)",
        error: message,
      });
    }
  }

  // Sincroniza planilha Google Sheets da Terrazzo (linhas do DRE alimentadas
  // pela planilha — mesmo padrao da Feat, config isolada). Roda apos os syncs
  // do Omie; falha aqui nao impede o restante. Sempre tenta (a planilha tem
  // default embutido); pode ser desabilitada via TERRAZZO_SHEETS_SYNC_DISABLED.
  let terrazzoSheetsSync: {
    ok: boolean;
    yearsRead?: number[];
    periodsUpserted?: number;
    error?: string;
  } | null = null;
  if (process.env.TERRAZZO_SHEETS_SYNC_DISABLED !== "true") {
    try {
      const result = await syncTerrazzoSheetsToManualValues();
      terrazzoSheetsSync = {
        ok: true,
        yearsRead: result.yearsRead,
        periodsUpserted: result.periodsUpserted,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha desconhecida no sync da planilha Terrazzo.";
      terrazzoSheetsSync = { ok: false, error: message };
      failures.push({
        companyId: "terrazzo-sheets",
        companyName: "Terrazzo (planilha)",
        error: message,
      });
    }
  }

  // Sincroniza planilha Google Sheets da Sirena (linha "Locação de Espaço";
  // mesmo padrao da Terrazzo, config isolada). Falha aqui nao impede o restante.
  // Pode ser desabilitada via SIRENA_SHEETS_SYNC_DISABLED.
  let sirenaSheetsSync: {
    ok: boolean;
    yearsRead?: number[];
    periodsUpserted?: number;
    error?: string;
  } | null = null;
  if (process.env.SIRENA_SHEETS_SYNC_DISABLED !== "true") {
    try {
      const result = await syncSirenaSheetsToManualValues();
      sirenaSheetsSync = {
        ok: true,
        yearsRead: result.yearsRead,
        periodsUpserted: result.periodsUpserted,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha desconhecida no sync da planilha Sirena.";
      sirenaSheetsSync = { ok: false, error: message };
      failures.push({
        companyId: "sirena-sheets",
        companyName: "Sirena (planilha)",
        error: message,
      });
    }
  }

  // Espelha os cadastros (clientes/fornecedores) da unidade Omie da Case Shows
  // para o banco local do Case (case_clients/case_bands). Mesmo padrao best-effort
  // das planilhas: falha aqui nao impede o resto. Pula sem credenciais Omie.
  let caseCadastrosSync: {
    ok: boolean;
    fetched?: number;
    clients?: { inserted: number; updated: number };
    bands?: { inserted: number; updated: number };
    skipped?: string;
    error?: string;
  } | null = null;
  try {
    const r = await syncCaseCadastrosFromOmie(supabase);
    caseCadastrosSync = { ok: true, fetched: r.fetched, clients: r.clients, bands: r.bands, skipped: r.skipped };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha desconhecida no sync de cadastros da Case.";
    caseCadastrosSync = { ok: false, error: message };
    failures.push({ companyId: "case-cadastros", companyName: "Case Shows (cadastros Omie)", error: message });
  }

  // Espelha o status de pagamento (pago/pendente) dos títulos Case já lançados
  // no Omie. Roda após o sync de cadastros; best-effort.
  let casePagamentosSync: {
    ok: boolean;
    atualizados?: number;
    pagos?: number;
    skipped?: string;
    error?: string;
  } | null = null;
  try {
    const r = await syncCasePagamentosFromOmie(supabase);
    casePagamentosSync = { ok: true, atualizados: r.atualizados, pagos: r.pagos, skipped: r.skipped };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha desconhecida no sync de pagamentos da Case.";
    casePagamentosSync = { ok: false, error: message };
    failures.push({ companyId: "case-pagamentos", companyName: "Case Shows (status pagamentos Omie)", error: message });
  }

  await Promise.all([
    sendSyncFailureEmail(failures),
    sendUnmappedCategoriesEmail(unmappedCategories),
    sendUnmappedEntriesAlertEmail(unmappedEntries),
  ]);

  return NextResponse.json({
    ok: failures.length === 0,
    processed: results.length,
    failed: failures.length,
    unmappedCategories: unmappedCategories.length,
    unmappedEntries: unmappedEntries.length,
    results,
    featSheetsSync,
    terrazzoSheetsSync,
    sirenaSheetsSync,
    caseCadastrosSync,
    casePagamentosSync,
  });
}
