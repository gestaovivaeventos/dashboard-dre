const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");
const envPath = path.resolve(__dirname, "..", ".env.local");
for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

async function main() {
  const { data: e } = await supabase
    .from("financial_entries")
    .select("*")
    .eq("omie_id", "mov:cc:9617687160")
    .maybeSingle();

  console.log("Colunas:", Object.keys(e));
  console.log("created_at:", e.created_at, "| updated_at:", e.updated_at);
  console.log("synced_at:", e.synced_at, "| last_synced_at:", e.last_synced_at);
  console.log("category_code:", e.category_code, "| category_name:", e.category_name);
  console.log("\n=== RAW_JSON ===");
  console.log(JSON.stringify(e.raw_json, null, 2));

  // Último sync da Case Shows
  const { data: logs } = await supabase
    .from("sync_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(5);
  console.log("\n=== Últimos sync_logs ===");
  for (const l of logs ?? []) {
    console.log(`${l.created_at} | ${l.status ?? ""} | ${l.company_id ?? ""} | ${l.mode ?? ""}`);
  }

  // O que é a categoria 1.01.02 no cadastro Omie (se houver tabela)
  const { data: cat, error: catErr } = await supabase
    .from("omie_categories")
    .select("*")
    .eq("code", "1.01.02");
  if (catErr) console.log("\n(omie_categories indisponível:", catErr.message, ")");
  else console.log("\nomie_categories 1.01.02:", JSON.stringify(cat));
}
main().catch((e) => { console.error(e); process.exit(1); });
