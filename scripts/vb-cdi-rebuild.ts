// scripts/vb-cdi-rebuild.ts
// Refaz os rendimentos por CDI de todos os credores ativos com as regras
// atuais do motor (cortes de fim de mês e de cada movimentação): apaga os
// rendimentos CDI existentes e recalcula do fim do último rendimento
// importado até a última taxa gravada. O histórico da planilha não é tocado.
//
// Uso (na raiz do projeto, com .env.local carregado):
//   set -a; source .env.local; set +a
//   npx tsx --conditions=react-server scripts/vb-cdi-rebuild.ts        # prévia, nada gravado
//   DRY=0 npx tsx --conditions=react-server scripts/vb-cdi-rebuild.ts  # executa
//
// Existe porque o primeiro lançamento em produção (11/09/2026) foi feito antes
// do corte de fim de mês e deixou agosto/2026 sem rendimento no extrato.

import { createAdminClient } from "@/lib/supabase/admin";
import { buildCdiPlan, reconcileCdiAfterChange } from "@/lib/vb/cdi/service";
import { listCreditors } from "@/lib/vb/queries";

const DRY = process.env.DRY !== "0";

async function main() {
  const admin = createAdminClient();
  const creditors = (await listCreditors(admin)).filter((c) => c.active);
  const { data: current, error } = await admin
    .from("vb_entries")
    .select("creditor_id, period_start, period_end, amount")
    .eq("status", "aprovado")
    .eq("kind", "rendimento")
    .eq("rate_basis", "cdi")
    .order("period_end");
  if (error) throw new Error(error.message);

  console.log(`${(current ?? []).length} rendimento(s) por CDI hoje:`);
  for (const r of current ?? []) {
    const name = creditors.find((c) => c.id === r.creditor_id)?.name ?? r.creditor_id;
    console.log(`  ${name.padEnd(10)} ${r.period_start} → ${r.period_end}  ${Number(r.amount).toFixed(2)}`);
  }
  if (DRY) {
    console.log("\nDRY RUN — nada gravado. Rode com DRY=0 para apagar e recalcular.");
    return;
  }

  let removed = 0;
  let created = 0;
  for (const c of creditors) {
    const r = await reconcileCdiAfterChange(admin, [c.id], "1900-01-01", null);
    removed += r.removed;
    created += r.created;
    console.log(`${c.name.padEnd(10)} apagados=${r.removed} gravados=${r.created}`);
  }
  console.log(`\nTOTAL apagados=${removed} gravados=${created}`);
  const remaining = await buildCdiPlan(admin, {});
  console.log(`resta a lançar: ${remaining.items.length} (esperado 0)`);
}

main().catch((e) => {
  console.error("FALHOU:", e instanceof Error ? e.message : e);
  process.exit(1);
});
