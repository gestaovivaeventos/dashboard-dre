// READ-ONLY conference query for the Terrazzo Omie cleanup (2022-2024).
// Does NOT delete anything. Identifies exactly which financial_entries rows
// would be removed and confirms 2025/2026 stay intact, plus other companies.
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

async function count(filter) {
  const { count, error } = await filter;
  if (error) throw error;
  return count ?? 0;
}

(async () => {
  // 1) Resolve Terrazzo company(ies). Assert exactly one.
  const { data: companies, error: cErr } = await db
    .from("companies")
    .select("id, name")
    .ilike("name", "%terrazzo%");
  if (cErr) throw cErr;
  log("== Empresas que batem com 'terrazzo' ==");
  log(companies);
  if (!companies || companies.length !== 1) {
    log(`\n!! ABORTAR: esperava exatamente 1 empresa Terrazzo, achei ${companies?.length ?? 0}. Revisar antes de prosseguir.`);
    return;
  }
  const terrazzo = companies[0];
  log(`\nTerrazzo company_id = ${terrazzo.id} (name='${terrazzo.name}')\n`);

  const base = () =>
    db.from("financial_entries").select("*", { count: "exact", head: true }).eq("company_id", terrazzo.id);

  // 2) Total de financial_entries da Terrazzo
  const total = await count(base());
  log(`Total financial_entries Terrazzo (todas as datas): ${total}`);

  // 3) Alvo da remoção: 2022-01-01 .. 2024-12-31
  const target = await count(base().gte("payment_date", "2022-01-01").lte("payment_date", "2024-12-31"));
  log(`\n>>> ALVO DA REMOÇÃO (payment_date 2022-01-01..2024-12-31): ${target}`);

  // breakdown por tipo no alvo
  for (const [tipo, label] of [["despesa", "contas a pagar"], ["receita", "contas a receber"]]) {
    const n = await count(
      base().eq("type", tipo).gte("payment_date", "2022-01-01").lte("payment_date", "2024-12-31"),
    );
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
  log(`\n>>> SERÁ PRESERVADO (Terrazzo, payment_date >= 2025-01-01):`);
  const keep2025plus = await count(base().gte("payment_date", "2025-01-01"));
  log(`    >= 2025-01-01: ${keep2025plus}`);
  for (const [y, from, to] of [
    [2025, "2025-01-01", "2025-12-31"],
    [2026, "2026-01-01", "2026-12-31"],
  ]) {
    const n = await count(base().gte("payment_date", from).lte("payment_date", to));
    log(`    ${y}: ${n}`);
  }
  // sanity: anything before 2022?
  const before2022 = await count(base().lt("payment_date", "2022-01-01"));
  log(`    (sanity) < 2022-01-01: ${before2022}`);
  const nullDate = await count(base().is("payment_date", null));
  log(`    (sanity) payment_date NULL: ${nullDate}`);

  // 5) Amostra dos registros que serão removidos (10 linhas) para inspeção
  const { data: sample, error: sErr } = await db
    .from("financial_entries")
    .select("id, omie_id, type, description, value, payment_date, category_code, supplier_customer")
    .eq("company_id", terrazzo.id)
    .gte("payment_date", "2022-01-01")
    .lte("payment_date", "2024-12-31")
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
    .gte("payment_date", "2022-01-01")
    .lte("payment_date", "2024-12-31");
  log(`\n(sanity) financial_entries 2022-2024 de TODAS as empresas: ${allTargetYears}`);
  log(`(sanity) destes, Terrazzo representa: ${target}  => outras empresas (NÃO tocar): ${allTargetYears - target}`);

  // 7) manual_account_values (Sheets/manual) da Terrazzo — NÃO será tocado, só relatar
  const { count: mavCount } = await db
    .from("manual_account_values")
    .select("*", { count: "exact", head: true })
    .eq("company_id", terrazzo.id);
  log(`\n(preservado/intocado) manual_account_values da Terrazzo (Sheets/manual): ${mavCount}`);

  log("\n== Conferência concluída. NENHUM dado foi removido. ==");
})().catch((e) => {
  console.error("ERRO:", e.message ?? e);
  process.exit(1);
});
