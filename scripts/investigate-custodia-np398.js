// Investigação pontual: Contrato CASE NP 398 (Medicina Cento e Dois) R$ 1.000
// Por que aparece em "1.1 - Clientes - Serviços Prestados" se no Omie a
// categoria é "Custódia de Valores de Artistas"?
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

const envPath = path.resolve(__dirname, "..", ".env.local");
const envContent = fs.readFileSync(envPath, "utf-8");
for (const line of envContent.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

async function main() {
  const { data: companies } = await supabase
    .from("companies")
    .select("id, name")
    .ilike("name", "%case%shows%");
  console.log("Empresas Case Shows:", companies);

  for (const co of companies ?? []) {
    const { data: entries, error } = await supabase
      .from("financial_entries")
      .select(
        "id, omie_id, type, value, payment_date, supplier_customer, description, document_number, category_code, category_name, raw_json",
      )
      .eq("company_id", co.id)
      .gte("payment_date", "2025-05-01")
      .lte("payment_date", "2025-06-02")
      .or("description.ilike.%NP 398%,document_number.ilike.%398%");

    if (error) {
      console.error("Erro entries:", error);
      continue;
    }

    console.log(`\n=== ${co.name} (${co.id}) — ${entries.length} entries ===`);

    for (const e of entries) {
      console.log("\n--- ENTRY ---");
      console.log(`omie_id: ${e.omie_id} | type: ${e.type} | value: ${e.value}`);
      console.log(`payment_date: ${e.payment_date}`);
      console.log(`supplier: ${e.supplier_customer}`);
      console.log(`description: ${e.description}`);
      console.log(`document: ${e.document_number}`);
      console.log(`category_code: ${e.category_code} | category_name: ${e.category_name}`);
      const raw = e.raw_json ?? {};
      console.log("raw.categorias:", JSON.stringify(raw.categorias ?? null));

      // Mapeamento desse category_code -> conta DRE (global + por empresa)
      const { data: maps } = await supabase
        .from("category_mapping")
        .select("id, company_id, omie_category_code, dre_account_id")
        .eq("omie_category_code", e.category_code);
      console.log(`category_mapping rows p/ code ${e.category_code}:`, maps?.length ?? 0);
      for (const mp of maps ?? []) {
        const { data: acct } = await supabase
          .from("dre_accounts")
          .select("id, code, name, company_id")
          .eq("id", mp.dre_account_id)
          .maybeSingle();
        console.log(
          `  -> mapping company_id=${mp.company_id ?? "GLOBAL"} => conta ${acct?.code} "${acct?.name}" (acct.company_id=${acct?.company_id ?? "GLOBAL"})`,
        );
      }
    }
  }
}

main().catch((err) => {
  console.error("Falha:", err);
  process.exit(1);
});
