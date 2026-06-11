// READ-ONLY post-cleanup verification.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const log = (...a) => console.log(...a);
const cnt = async (q) => { const { count, error } = await q; if (error) throw error; return count ?? 0; };

(async () => {
  const id = "42cabbb2-af31-4273-917a-532707884a83"; // Terrazzo
  const fe = () => db.from("financial_entries").select("*", { count: "exact", head: true }).eq("company_id", id);

  log("=== 1) financial_entries Terrazzo ===");
  log(`  2022-2024 (deve ser 0): ${await cnt(fe().gte("payment_date", "2022-01-01").lte("payment_date", "2024-12-31"))}`);
  log(`  2025: ${await cnt(fe().gte("payment_date", "2025-01-01").lte("payment_date", "2025-12-31"))}`);
  log(`  2026: ${await cnt(fe().gte("payment_date", "2026-01-01").lte("payment_date", "2026-12-31"))}`);
  log(`  total: ${await cnt(fe())}`);

  log("\n=== 2) dre_monthly_aggregates Terrazzo (alimenta DASHBOARD) ===");
  const dre = () => db.from("dre_monthly_aggregates").select("*", { count: "exact", head: true }).eq("company_id", id);
  log(`  anos 2022-2024 (deve ser 0): ${await cnt(dre().gte("year", 2022).lte("year", 2024))}`);
  log(`  ano 2025: ${await cnt(dre().eq("year", 2025))}`);
  log(`  ano 2026: ${await cnt(dre().eq("year", 2026))}`);

  log("\n=== 3) cash_flow_monthly_aggregates Terrazzo (alimenta FLUXO DE CAIXA) ===");
  const cf = () => db.from("cash_flow_monthly_aggregates").select("*", { count: "exact", head: true }).eq("company_id", id);
  log(`  anos 2022-2024 (deve ser 0): ${await cnt(cf().gte("year", 2022).lte("year", 2024))}`);
  log(`  ano 2025: ${await cnt(cf().eq("year", 2025))}`);
  log(`  ano 2026: ${await cnt(cf().eq("year", 2026))}`);

  log("\n=== 4) Outras empresas intactas (2022-2024) ===");
  const allTarget = await cnt(db.from("financial_entries").select("*", { count: "exact", head: true }).gte("payment_date", "2022-01-01").lte("payment_date", "2024-12-31"));
  log(`  financial_entries 2022-2024 de TODAS as empresas agora: ${allTarget} (esperado 64480 = 70242 - 5762)`);

  log("\n=== 5) Dados preservados (não-Omie) ===");
  log(`  manual_account_values Terrazzo (Sheets/manual): ${await cnt(db.from("manual_account_values").select("*", { count: "exact", head: true }).eq("company_id", id))}`);

  log("\n=== 6) Estruturas/regras preservadas (contagens, não alteradas) ===");
  log(`  dre_accounts Terrazzo: ${await cnt(db.from("dre_accounts").select("*", { count: "exact", head: true }).eq("company_id", id))}`);
  log(`  cash_flow_accounts Terrazzo: ${await cnt(db.from("cash_flow_accounts").select("*", { count: "exact", head: true }).eq("company_id", id))}`);
  log(`  category_mappings Terrazzo: ${await cnt(db.from("category_mappings").select("*", { count: "exact", head: true }).eq("company_id", id))}`);

  log("\n== Verificação concluída. ==");
})().catch((e) => { console.error("ERRO:", e.message ?? e); process.exit(1); });
