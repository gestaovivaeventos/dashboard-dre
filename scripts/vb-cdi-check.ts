// scripts/vb-cdi-check.ts
// Confere o motor de rendimento contra um período JÁ FECHADO do histórico
// importado: busca o CDI real do período no Banco Central, aplica o motor
// sobre o saldo daquele momento e compara com o valor que a planilha lançou.
// Não toca no banco de dados de nenhuma forma além de ler.
//
//   npx tsx scripts/vb-cdi-check.ts

import { createClient } from "@supabase/supabase-js";

import { fetchCdiRange } from "@/lib/vb/cdi/bcb";
import { planAccrual } from "@/lib/vb/cdi/accrual";
import { currentBalance } from "@/lib/vb/ledger";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  const db = createClient(url, key);

  const { data: rendimentos, error } = await db
    .from("vb_entries")
    .select("creditor_id, period_start, period_end, rate, amount, vb_creditors(name)")
    .eq("status", "aprovado")
    .eq("kind", "rendimento")
    .eq("rate_basis", "periodo")
    .not("period_start", "is", null)
    .order("entry_date", { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);

  for (const row of (rendimentos ?? []) as Array<Record<string, unknown>>) {
    const periodStart = row.period_start as string;
    const periodEnd = row.period_end as string;
    const creditorId = row.creditor_id as string;
    const nome = ((row.vb_creditors as { name?: string } | null)?.name) ?? creditorId;

    const { data: entries } = await db
      .from("vb_entries")
      .select("id, entry_date, sort_order, created_at, kind, amount")
      .eq("creditor_id", creditorId)
      .eq("status", "aprovado")
      .lte("entry_date", periodEnd);
    const rows = (entries ?? []).map((e) => ({ ...e, amount: Number((e as { amount: number | string }).amount) }));

    const rates = new Map((await fetchCdiRange(periodStart, periodEnd)).map((r) => [r.rate_date, r.rate]));
    const segments = planAccrual({ entries: rows, rates, from: periodStart, until: periodEnd });
    const calculado = segments.reduce((sum, s) => sum + s.amount, 0);
    const lancado = Number(row.amount);
    const saldo = currentBalance(rows.filter((e) => e.entry_date <= periodStart));

    console.log(
      `${nome.padEnd(10)} ${periodStart} a ${periodEnd}` +
        ` | saldo ${saldo.toFixed(2)}` +
        ` | planilha ${lancado.toFixed(2)} (taxa ${(Number(row.rate) * 100).toFixed(4)}%)` +
        ` | CDI real ${calculado.toFixed(2)}` +
        ` | diferença ${(calculado - lancado).toFixed(2)}`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
