// Fase 0 do módulo Caixa: confere, contra uma empresa REAL, se a Omie entrega
// o saldo de conta corrente do jeito que o desenho assume. Não toca no banco —
// só lê as credenciais e chama a Omie.
//
//   npx tsx scripts/caixa-omie-probe.ts            # primeira empresa com credencial
//   npx tsx scripts/caixa-omie-probe.ts terrazzo   # filtra pelo nome
//
// Responde três perguntas que decidem a migration e o motor de saldos:
//
//   1. ListarContasCorrentes (completa) traz banco/agência/conta? (colunas da tela)
//   2. ListarExtrato devolve nSaldoAtual preenchido com período de hoje/hoje?
//   3. nSaldoAtual MUDA conforme o período pedido? Se mudar, "saldo atual" é na
//      verdade "saldo ao fim do período" e o motor precisa fixar a data final —
//      caso contrário podemos usar a janela mínima e economizar payload.

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

import { omieCall } from "../src/lib/omie/client";
import { decryptSecret } from "../src/lib/security/encryption";

config({ path: ".env.local" });

const CONTAS_URL = "https://app.omie.com.br/api/v1/geral/contacorrente/";
const EXTRATO_URL = "https://app.omie.com.br/api/v1/financas/extrato/";

// A comparação de janelas é opcional: ela repete a MESMA chamada várias vezes
// e a Omie bloqueia repetição idêntica numa janela de ~40s ("consumo
// redundante"). Sem a flag, o script faz o mínimo e pode rodar em sequência.
const args = process.argv.slice(2).filter((a) => a !== "--janelas");
const compararJanelas = process.argv.includes("--janelas");
const filter = (args[0] ?? "").toLowerCase();

function ddmmyyyy(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

/** Hoje no fuso de Brasília (o "saldo de hoje" é o dia no Brasil, não em UTC). */
function todayBR(): Date {
  return new Date(Date.now() - 3 * 60 * 60 * 1000);
}

function brl(v: unknown): string {
  return typeof v === "number"
    ? v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : String(v ?? "—");
}

/** Só os campos escalares do topo da resposta — o que serve de saldo. */
function scalars(data: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(data).filter(
    ([, v]) => v === null || ["number", "string", "boolean"].includes(typeof v),
  );
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data: companies, error } = await supabase
    .from("companies")
    .select("id,name,active,sync_enabled,omie_app_key,omie_app_secret")
    .eq("active", true)
    .order("name");
  if (error) throw new Error(error.message);

  const withCreds = (companies ?? []).filter((c) => c.omie_app_key && c.omie_app_secret);

  console.log(`Empresas ativas: ${companies?.length ?? 0} · com credencial Omie: ${withCreds.length}`);
  const semCred = (companies ?? []).filter((c) => !c.omie_app_key || !c.omie_app_secret);
  if (semCred.length > 0) {
    console.log(`Sem credencial (ficam de fora do Caixa): ${semCred.map((c) => c.name).join(", ")}`);
  }
  const syncOff = withCreds.filter((c) => c.sync_enabled === false);
  if (syncOff.length > 0) {
    console.log(`Com credencial mas sync_enabled=false: ${syncOff.map((c) => c.name).join(", ")}`);
  }
  console.log("");

  const company = filter
    ? withCreds.find((c) => (c.name ?? "").toLowerCase().includes(filter))
    : withCreds[0];
  if (!company) throw new Error(`Nenhuma empresa com credencial${filter ? ` casando com "${filter}"` : ""}.`);

  const appKey = decryptSecret(company.omie_app_key as string);
  const appSecret = decryptSecret(company.omie_app_secret as string);
  console.log(`━━━ Empresa: ${company.name} ━━━\n`);

  // ── 1. Cadastro completo das contas ────────────────────────────────────────
  const contas = await omieCall(CONTAS_URL, "ListarContasCorrentes", appKey, appSecret, {
    pagina: 1,
    registros_por_pagina: 50,
    apenas_importado_api: "N",
  });
  if (contas.notFound) {
    console.log("ListarContasCorrentes: nenhuma conta cadastrada.");
    return;
  }

  const lista = (contas.data.ListarContasCorrentes ?? contas.data.conta_corrente_cadastro ?? []) as
    Record<string, unknown>[];
  console.log(`[1] ListarContasCorrentes → ${lista.length} conta(s) nesta página`);
  console.log(`    chaves de resposta: ${Object.keys(contas.data).join(", ")}`);
  if (lista.length > 0) {
    console.log(`\n    Primeira conta (campos brutos):`);
    for (const [k, v] of Object.entries(lista[0])) {
      if (v === null || v === "" ) continue;
      if (typeof v === "object") continue;
      console.log(`      ${k.padEnd(28)} ${String(v)}`);
    }
  }

  // Campos que viram colunas da tela. Interessa saber quais vêm preenchidos
  // numa conta de BANCO de verdade (a "Caixinha" não tem agência/conta).
  console.log(`\n    Todas as contas (campos que viram coluna):`);
  for (const c of lista) {
    console.log(
      `      nCodCC=${String(c.nCodCC ?? "").padEnd(12)} ` +
        `tipo=${String(c.tipo_conta_corrente ?? "").padEnd(4)} ` +
        `inativo=${String(c.inativo ?? "-").padEnd(2)} ` +
        `banco=${String(c.codigo_banco ?? "—").padEnd(5)} ` +
        `ag=${String(c.codigo_agencia ?? c.agencia ?? "—").padEnd(8)} ` +
        `conta=${String(c.numero_conta_corrente ?? c.conta_corrente ?? "—").padEnd(12)} ` +
        `${String(c.descricao ?? "")}`,
    );
  }

  // Dump completo da primeira conta bancária de verdade (tipo CC e com banco
  // != 999, que é o placeholder da Omie para caixa físico).
  const bancaria = lista.find(
    (c) => c.tipo_conta_corrente === "CC" && String(c.codigo_banco ?? "") !== "999" && c.inativo !== "S",
  );
  if (bancaria) {
    console.log(`\n    Conta bancária "${bancaria.descricao}" — todos os campos preenchidos:`);
    for (const [k, v] of Object.entries(bancaria)) {
      if (v === null || v === "" || typeof v === "object") continue;
      console.log(`      ${k.padEnd(28)} ${String(v)}`);
    }
  } else {
    console.log(`\n    (nenhuma conta bancária "de verdade" nesta empresa)`);
  }

  // ── 2 e 3. Saldo via extrato, em duas janelas ──────────────────────────────
  const alvo = lista.find((c) => c.inativo !== "S") ?? lista[0];
  if (!alvo) return;

  const hoje = todayBR();
  const mesPassado = new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000);

  const janelas: Array<{ nome: string; de: Date; ate: Date }> = [
    { nome: "hoje → hoje", de: hoje, ate: hoje },
    { nome: "30 dias → hoje", de: mesPassado, ate: hoje },
    { nome: "30 dias → 30 dias", de: mesPassado, ate: mesPassado },
  ];

  console.log(`\n[2/3] ListarExtrato · conta nCodCC=${alvo.nCodCC} (${alvo.descricao})`);
  if (!compararJanelas) console.log("      (comparação de janelas: rode com --janelas)");

  for (const j of compararJanelas ? janelas : janelas.slice(0, 1)) {
    const r = await omieCall(EXTRATO_URL, "ListarExtrato", appKey, appSecret, {
      nCodCC: Number(alvo.nCodCC),
      dPeriodoInicial: ddmmyyyy(j.de),
      dPeriodoFinal: ddmmyyyy(j.ate),
    });

    console.log(`\n    ── ${j.nome} (${ddmmyyyy(j.de)} a ${ddmmyyyy(j.ate)}) ──`);
    if (r.notFound) {
      console.log("       resposta: sem registros (notFound)");
      continue;
    }

    const movimentos = (r.data.listaMovimentos ?? []) as unknown[];
    console.log(`       movimentos no período: ${movimentos.length}`);
    for (const [k, v] of scalars(r.data)) {
      if (!/saldo|limite/i.test(k)) continue;
      console.log(`       ${k.padEnd(26)} ${brl(v)}`);
    }
    for (const [k, v] of scalars(r.data)) {
      if (/saldo|limite/i.test(k)) continue;
      console.log(`       ${k.padEnd(26)} ${String(v)}`);
    }
  }

  // ── 4. Custo real: saldo de TODAS as contas ativas da empresa ──────────────
  const ativas = lista.filter((c) => c.inativo !== "S");
  const hojeStr = ddmmyyyy(hoje);
  console.log(`\n[4] Saldo de todas as ${ativas.length} contas ativas (janela hoje/hoje)`);
  const t0 = Date.now();
  let total = 0;
  for (const c of ativas) {
    const r = await omieCall(EXTRATO_URL, "ListarExtrato", appKey, appSecret, {
      nCodCC: Number(c.nCodCC),
      dPeriodoInicial: hojeStr,
      dPeriodoFinal: hojeStr,
    });
    const saldo = r.notFound ? null : (r.data.nSaldoAtual as number | undefined) ?? null;
    if (typeof saldo === "number") total += saldo;
    console.log(
      `       ${String(c.tipo_conta_corrente ?? "").padEnd(3)} ` +
        `${String(c.descricao ?? "").slice(0, 28).padEnd(30)} ` +
        `${brl(saldo).padStart(16)}`,
    );
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`       ${"".padEnd(34)}${"─".repeat(16)}`);
  console.log(`       ${"TOTAL".padEnd(34)}${brl(total).padStart(16)}`);
  console.log(`\n       ${ativas.length} conta(s) em ${secs}s → ~${(Number(secs) / Math.max(1, ativas.length)).toFixed(2)}s por conta`);

  console.log(`
━━━ Como ler ━━━
 • nSaldoAtual IGUAL nas três janelas → é o saldo de HOJE, independente do
   período. Podemos pedir a janela mínima (hoje/hoje) e o payload fica pequeno.
 • nSaldoAtual DIFERENTE na janela "30 dias → 30 dias" → é o saldo ao FIM do
   período, e o motor precisa sempre fixar dPeriodoFinal = hoje.
`);
}

main().catch((err) => {
  console.error(`\nFALHOU: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
