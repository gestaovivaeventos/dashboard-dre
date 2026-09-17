// Varredura do módulo Caixa fora do app — primeira carga e diagnóstico.
//
//   npx tsx --conditions=react-server scripts/caixa-sweep.ts cadastro
//   npx tsx --conditions=react-server scripts/caixa-sweep.ts saldos
//   npx tsx --conditions=react-server scripts/caixa-sweep.ts tudo
//
// (a flag --conditions=react-server é necessária por causa do "server-only"
// importado por src/lib/caixa/sync.ts — mesmo motivo do vb-cdi-rebuild.ts)
//
// Faz exatamente o que o cron /api/cron/caixa-saldos faz, com o mesmo
// paralelismo por empresa, e imprime o resultado por unidade. Útil para a
// carga inicial logo depois da migration, quando a tela ainda está vazia.

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

async function main() {
  const modo = (process.argv[2] ?? "tudo").toLowerCase();
  if (!["cadastro", "saldos", "tudo"].includes(modo)) {
    throw new Error('Use: cadastro | saldos | tudo');
  }

  // Import dinâmico: os módulos abaixo leem process.env na carga, então só
  // podem ser resolvidos depois do dotenv acima.
  const { runCaixaSweep } = await import("../src/lib/caixa/sync");
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const admin = createAdminClient();

  for (const kind of modo === "tudo" ? (["cadastro", "saldos"] as const) : [modo as "cadastro" | "saldos"]) {
    const started = Date.now();
    console.log(`\n━━━ ${kind.toUpperCase()} ━━━`);
    const { results } = await runCaixaSweep(admin, { kind, trigger: "manual" });

    for (const r of [...results].sort((a, b) => a.companyName.localeCompare(b.companyName, "pt-BR"))) {
      const status = r.ok ? "ok " : "ERR";
      console.log(
        `  ${status} ${r.companyName.padEnd(30)} ` +
          `contas=${String(r.accountsOk).padStart(3)}` +
          (r.accountsError > 0 ? ` falhas=${r.accountsError}` : "") +
          (r.error ? `  ${r.error}` : ""),
      );
    }

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `  ── ${results.length} empresa(s), ` +
        `${results.reduce((s, r) => s + r.accountsOk, 0)} conta(s), ` +
        `${results.filter((r) => !r.ok).length} com erro, em ${secs}s`,
    );
  }
}

main().catch((err) => {
  console.error(`\nFALHOU: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
