// Correção pontual: zera os 3 entries de WAGNER GONCALVES VENIALGO em Viva Campo Grande 07/2025
// que tiveram desconto integral mas estavam contabilizados pelo bruto na DRE.
//
// Aplica a regra de regime de caixa: value = nValPago - desconto + juros + multa.
// Para esses 3 títulos: value = 34,93 - 34,93 = 0 (e 11,64 - 11,64 = 0).
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

const COMPANY_ID = "58d6c2e2-accb-4ca7-aca4-4163a9d1059e"; // Viva Campo Grande
const TARGETS = [
  "mov:3798168896:008/013:MANP",
  "mov:3798169054:008/013:MANP",
  "mov:3798169230:008/013:MANP",
];

async function main() {
  console.log("Buscando entries antes da correção...");
  const { data: before, error: e1 } = await supabase
    .from("financial_entries")
    .select("omie_id, value, processing_metadata, supplier_customer, category_code")
    .eq("company_id", COMPANY_ID)
    .in("omie_id", TARGETS);

  if (e1) throw e1;

  console.log("\nAntes:");
  let totalAntes = 0;
  for (const e of before) {
    console.log(`  ${e.omie_id}: value=${e.value}, categoria=${e.category_code}`);
    totalAntes += Number(e.value);
  }
  console.log(`  Total: R$ ${totalAntes.toFixed(2)}`);

  console.log("\nAtualizando cada entry individualmente...");
  for (const e of before) {
    const newMeta = {
      ...(e.processing_metadata ?? {}),
      adjusted_for_cash: true,
      source_field_value: "nValLiquido",
    };
    const { error } = await supabase
      .from("financial_entries")
      .update({
        value: 0,
        processing_metadata: newMeta,
      })
      .eq("company_id", COMPANY_ID)
      .eq("omie_id", e.omie_id);
    if (error) {
      console.error(`  Falha em ${e.omie_id}:`, error);
      process.exit(1);
    }
    console.log(`  OK: ${e.omie_id} -> value=0`);
  }

  // Confirma
  const { data: after, error: e3 } = await supabase
    .from("financial_entries")
    .select("omie_id, value, processing_metadata")
    .eq("company_id", COMPANY_ID)
    .in("omie_id", TARGETS);

  if (e3) throw e3;

  console.log("\nDepois:");
  let totalDepois = 0;
  for (const e of after) {
    console.log(
      `  ${e.omie_id}: value=${e.value}, adjusted_for_cash=${
        (e.processing_metadata ?? {}).adjusted_for_cash
      }`,
    );
    totalDepois += Number(e.value);
  }
  console.log(`  Total: R$ ${totalDepois.toFixed(2)}`);
  console.log(`\nValor removido da DRE: R$ ${(totalAntes - totalDepois).toFixed(2)}`);
}

main().catch((err) => {
  console.error("Falha:", err);
  process.exit(1);
});
