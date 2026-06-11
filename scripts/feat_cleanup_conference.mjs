// READ-ONLY conference query for the Feat Producoes Omie cleanup (2022-2024).
// Does NOT delete anything. Identifies exactly which financial_entries rows
// (Omie-synced contas a pagar/receber) would be removed and confirms that
// 2025/2026 stay intact, that other companies are untouched, and that the
// Google Sheets / manual data (manual_account_values, manual_entries) is NOT
// part of the deletion scope.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// Load env from .env.local
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const db = createClient(url, key, { auth: { persistSession: false } });

const log = (...a) => console.log(...a);
const FROM = "2022-01-01";
const TO = "2024-12-31";

async function count(filter) {
  const { count, error } = await filter;
  if (error) throw error;
  return count ?? 0;
}

(async () => {
  // 1) Resolve Feat Producoes company(ies). Assert exactly one.
  //    Match is tolerant to accents/spelling ("Feat Producoes" / "Feat Produções").
  const { data: companies, error: cErr } = await db
    .from("companies")
    .select("id, name")
    .ilike("name", "%feat%produ%");
  if (cErr) throw cErr;
  log("== Empresas que batem com 'feat...produ' ==");
  log(companies);
  if (!companies || companies.length !== 1) {
    log(`\n!! ABORTAR: esperava exatamente 1 empresa Feat, achei ${companies?.length ?? 0}. Revisar antes de prosseguir.`);
    return;
  }
  const feat = companies[0];
  log(`\nFeat company_id = ${feat.id} (name='${feat.name}')\n`);

  const base = () =>
    db.from("financial_entries").select("*", { count: "exact", head: true }).eq("company_id", feat.id);

  // 2) Total de financial_entries da Feat (financial_entries = SO dados Omie).
  const total = await count(base());
  log(`Total financial_entries Feat (todas as datas, todos Omie): ${total}`);

  // 3) Alvo da remoção: payment_date 2022-01-01 .. 2024-12-31
  const target = await count(base().gte("payment_date", FROM).lte("payment_date", TO));
  log(`\n>>> ALVO DA REMOÇÃO (payment_date ${FROM}..${TO}): ${target}`);

  // breakdown por tipo no alvo (receita = contas a receber, despesa = contas a pagar)
  for (const [tipo, label] of [["despesa", "contas a pagar"], ["receita", "contas a receber"]]) {
    const n = await count(base().eq("type", tipo).gte("payment_date", FROM).lte("payment_date", TO));
    log(`    type='${tipo}' (${label}): ${n}`);
  }

  // breakdown por ano no alvo
  for (const [y, from, to] of [
    [2022, "2022-01-01", "2022-12-31"],
    [2023, "2023-01-01", "2023-12-31"],
    [2024, "2024-01-01", "2024-12-31"],
  ]) {
    const n = await count(base().gte("payment_date", from).lte("payment_date", to));
    const d = await count(base().eq("type", "despesa").gte("payment_date", from).lte("payment_date", to));
    const r = await count(base().eq("type", "receita").gte("payment_date", from).lte("payment_date", to));
    log(`    ${y}: total=${n}  (pagar=${d}, receber=${r})`);
  }

  // 4) Preservar: 2025+ (especialmente 2025 e 2026)
  log(`\n>>> SERÁ PRESERVADO (Feat, payment_date >= 2025-01-01):`);
  const keep2025plus = await count(base().gte("payment_date", "2025-01-01"));
  log(`    >= 2025-01-01: ${keep2025plus}`);
  for (const [y, from, to] of [
    [2025, "2025-01-01", "2025-12-31"],
    [2026, "2026-01-01", "2026-12-31"],
  ]) {
    const n = await count(base().gte("payment_date", from).lte("payment_date", to));
    log(`    ${y}: ${n}`);
  }
  // sanity: anything before 2022? payment_date NULL?
  const before2022 = await count(base().lt("payment_date", "2022-01-01"));
  log(`    (sanity) < 2022-01-01: ${before2022}`);
  const nullDate = await count(base().is("payment_date", null));
  log(`    (sanity) payment_date NULL: ${nullDate}`);

  // 5) Amostra dos registros que serão removidos (10 linhas) para inspeção
  const { data: sample, error: sErr } = await db
    .from("financial_entries")
    .select("id, omie_id, type, description, value, payment_date, category_code, supplier_customer")
    .eq("company_id", feat.id)
    .gte("payment_date", FROM)
    .lte("payment_date", TO)
    .order("payment_date", { ascending: true })
    .limit(10);
  if (sErr) throw sErr;
  log(`\n== Amostra (10) de registros que serão removidos ==`);
  for (const r of sample) {
    log(
      `   ${r.payment_date} | ${r.type} | ${String(r.value).padStart(12)} | ${r.category_code ?? "-"} | ${(r.description ?? "").slice(0, 40)}`,
    );
  }

  // 6) Sanidade multi-empresa: total geral de financial_entries 2022-2024 (todas)
  const { count: allTargetYears } = await db
    .from("financial_entries")
    .select("*", { count: "exact", head: true })
    .gte("payment_date", FROM)
    .lte("payment_date", TO);
  log(`\n(sanity) financial_entries 2022-2024 de TODAS as empresas: ${allTargetYears}`);
  log(`(sanity) destes, Feat representa: ${target}  => outras empresas (NÃO tocar): ${allTargetYears - target}`);

  // 7) Dados NÃO-Omie da Feat que NÃO serão tocados (Google Sheets / manual).
  const { count: mavCount } = await db
    .from("manual_account_values")
    .select("*", { count: "exact", head: true })
    .eq("company_id", feat.id);
  log(`\n(preservado/intocado) manual_account_values da Feat (Google Sheets): ${mavCount}`);
  const { count: meCount, error: meErr } = await db
    .from("manual_entries")
    .select("*", { count: "exact", head: true })
    .eq("company_id", feat.id);
  if (meErr) log(`(preservado/intocado) manual_entries da Feat: (tabela indisponível: ${meErr.message})`);
  else log(`(preservado/intocado) manual_entries da Feat (manual): ${meCount}`);

  log("\n== Conferência concluída. NENHUM dado foi removido. ==");
})().catch((e) => {
  console.error("ERRO:", e.message ?? e);
  process.exit(1);
});
