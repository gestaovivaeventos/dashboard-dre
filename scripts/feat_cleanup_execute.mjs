// EXECUTE the Feat Producoes Omie cleanup (2022-2024). Deletes financial_entries
// scoped strictly by company_id = Feat AND payment_date 2022-01-01..2024-12-31,
// then refreshes the DRE + cash-flow materializations for Feat (and any
// companies it routes departments into). Re-validates before and after.
//
// Scope guarantees:
//   • financial_entries holds ONLY Omie-synced data (every row has omie_id).
//   • Google Sheets / manual data lives in manual_account_values / manual_entries
//     and is NOT touched here.
//   • Only company_id = Feat and payment_date in [2022-01-01, 2024-12-31] match.
//   • 2025/2026 (>= 2025-01-01) is preserved; an assertion aborts on any drift.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const log = (...a) => console.log(...a);
const FROM = "2022-01-01";
const TO = "2024-12-31";

async function cnt(q) {
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

(async () => {
  // 1) Re-resolve Feat, assert exactly one.
  const { data: companies, error: cErr } = await db
    .from("companies")
    .select("id, name")
    .ilike("name", "%feat%produ%");
  if (cErr) throw cErr;
  if (!companies || companies.length !== 1) {
    throw new Error(`ABORT: esperava 1 empresa Feat, achei ${companies?.length ?? 0}`);
  }
  const id = companies[0].id;
  log(`Feat company_id = ${id} (name='${companies[0].name}')`);

  const base = () =>
    db.from("financial_entries").select("*", { count: "exact", head: true }).eq("company_id", id);

  // 2) Pre-delete validation
  const beforeTarget = await cnt(base().gte("payment_date", FROM).lte("payment_date", TO));
  const beforeKeep = await cnt(base().gte("payment_date", "2025-01-01"));
  const beforeTotal = await cnt(base());
  // sanity: nothing outside [target ∪ keep] (no <2022, no NULL) — else abort.
  const beforeBefore2022 = await cnt(base().lt("payment_date", FROM));
  const beforeNull = await cnt(base().is("payment_date", null));
  log(`PRE-DELETE: alvo(2022-2024)=${beforeTarget}  manter(>=2025)=${beforeKeep}  total=${beforeTotal}  (<2022=${beforeBefore2022}, null=${beforeNull})`);
  if (beforeTarget === 0) {
    log("Nada a remover (alvo=0). Encerrando sem delete.");
    return;
  }
  if (beforeTarget + beforeKeep + beforeBefore2022 + beforeNull !== beforeTotal) {
    throw new Error("ABORT: contagens nao reconciliam com o total. Revisar antes de deletar.");
  }

  // 3) DELETE — strictly scoped: company_id = Feat AND payment_date in [FROM, TO].
  log(`\nExecutando DELETE financial_entries WHERE company_id='${id}' AND payment_date BETWEEN '${FROM}' AND '${TO}' ...`);
  const { error: dErr } = await db
    .from("financial_entries")
    .delete()
    .eq("company_id", id)
    .gte("payment_date", FROM)
    .lte("payment_date", TO);
  if (dErr) throw dErr;

  // 4) Post-delete validation
  const afterTarget = await cnt(base().gte("payment_date", FROM).lte("payment_date", TO));
  const afterKeep = await cnt(base().gte("payment_date", "2025-01-01"));
  const afterTotal = await cnt(base());
  log(`\nPOS-DELETE: alvo(2022-2024)=${afterTarget}  manter(>=2025)=${afterKeep}  total=${afterTotal}`);
  log(`Removidos = ${beforeTotal - afterTotal} (esperado ${beforeTarget})`);

  if (afterTarget !== 0) throw new Error(`FALHA: ainda restam ${afterTarget} registros 2022-2024.`);
  if (afterKeep !== beforeKeep) throw new Error(`FALHA: contagem de >=2025 mudou (${beforeKeep} -> ${afterKeep}).`);
  if (beforeTotal - afterTotal !== beforeTarget) throw new Error(`FALHA: removidos != alvo.`);
  log("Validacao de contagens OK.");

  // 5) Refresh materializações (DRE + fluxo de caixa) para Feat + destinos roteados.
  const targets = new Set([id]);
  const { data: routes } = await db
    .from("company_departments")
    .select("routed_to_company_id")
    .eq("company_id", id)
    .not("routed_to_company_id", "is", null);
  (routes ?? []).forEach((r) => r.routed_to_company_id && targets.add(r.routed_to_company_id));
  const ids = Array.from(targets);
  log(`\nRefresh materializações para company_ids: ${ids.join(", ")}`);

  const dre = await db.rpc("refresh_dre_monthly_aggregates", { p_company_ids: ids });
  if (dre.error) log(`  ! refresh_dre_monthly_aggregates erro: ${dre.error.message}`);
  else log("  ✓ refresh_dre_monthly_aggregates OK");

  const cf = await db.rpc("refresh_cash_flow_monthly_aggregates", { p_company_ids: ids });
  if (cf.error) log(`  ! refresh_cash_flow_monthly_aggregates erro: ${cf.error.message}`);
  else log("  ✓ refresh_cash_flow_monthly_aggregates OK");

  log("\n== Limpeza concluída. ==");
})().catch((e) => {
  console.error("ERRO:", e.message ?? e);
  process.exit(1);
});
