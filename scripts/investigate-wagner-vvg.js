// Investigação pontual: WAGNER GONCALVES VENIALGO em Viva Campo Grande 07/2025
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// Parse .env.local manually para evitar dependência externa
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
  // Localiza empresa Viva Campo Grande
  const { data: companies } = await supabase
    .from("companies")
    .select("id, name")
    .ilike("name", "%campo grande%");

  console.log("Empresas encontradas:", companies);

  for (const co of companies ?? []) {
    const { data: entries, error } = await supabase
      .from("financial_entries")
      .select(
        "id, omie_id, type, value, payment_date, supplier_customer, category_code, category_name, processing_metadata, raw_json",
      )
      .eq("company_id", co.id)
      .gte("payment_date", "2025-07-01")
      .lte("payment_date", "2025-07-31")
      .ilike("supplier_customer", "%WAGNER%VENIALGO%");

    if (error) {
      console.error("Erro:", error);
      continue;
    }

    console.log(`\n=== ${co.name} (${co.id}) ===`);
    console.log(`Total entries: ${entries.length}`);

    for (const e of entries) {
      const meta = e.processing_metadata ?? {};
      console.log("\n---");
      console.log(`omie_id: ${e.omie_id}`);
      console.log(`type: ${e.type}, value: ${e.value}`);
      console.log(`date: ${e.payment_date}`);
      console.log(`supplier: ${e.supplier_customer}`);
      console.log(`category_code: ${e.category_code}, name: ${e.category_name}`);
      console.log("processing_metadata:", JSON.stringify(meta, null, 2));

      // Inspecionar raw_json relevante
      const raw = e.raw_json ?? {};
      const detalhes = raw.detalhes ?? {};
      const resumo = raw.resumo ?? {};
      console.log("RAW relevante:");
      console.log("  cOrigem:", raw.cOrigem ?? detalhes.cOrigem);
      console.log("  cGrupo:", raw.cGrupo ?? detalhes.cGrupo);
      console.log("  cNatureza:", raw.cNatureza ?? detalhes.cNatureza);
      console.log("  nCodMovCC:", raw.nCodMovCC ?? detalhes.nCodMovCC);
      console.log("  nCodBaixa:", raw.nCodBaixa ?? detalhes.nCodBaixa);
      console.log("  nValorMovCC:", raw.nValorMovCC ?? detalhes.nValorMovCC);
      console.log(
        "  nValPago (detalhes):",
        detalhes.nValPago ?? raw.nValPago,
      );
      console.log(
        "  nValLiquido (detalhes):",
        detalhes.nValLiquido ?? raw.nValLiquido,
      );
      console.log("  nDesconto:", raw.nDesconto ?? detalhes.nDesconto);
      console.log("  nJuros:", raw.nJuros ?? detalhes.nJuros);
      console.log("  nMulta:", raw.nMulta ?? detalhes.nMulta);
      console.log("  resumo.nValPago:", resumo.nValPago);
      console.log("  resumo.nValLiquido:", resumo.nValLiquido);
      console.log("  resumo.nValorTitulo:", resumo.nValorTitulo);
      console.log("  categorias:", JSON.stringify(raw.categorias ?? null));
    }

    const total = entries.reduce((s, e) => s + Number(e.value || 0), 0);
    console.log(`\nTotal somado: R$ ${total.toFixed(2)}`);
  }
}

main().catch((err) => {
  console.error("Falha:", err);
  process.exit(1);
});
