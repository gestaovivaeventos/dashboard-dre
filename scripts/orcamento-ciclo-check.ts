/**
 * Conferência do ciclo do orçamento (construção → validação → retorno).
 *
 *   npx tsx scripts/orcamento-ciclo-check.ts "Teste Módulo Orçamento" 2027
 *
 * SOMENTE LEITURA. Existe porque a parte mais importante do ciclo é invisível
 * na tela: a versão congelada, a trilha, a trava dos itens e o que de fato foi
 * para o Budget e Forecast. Rodar isto depois de cada passo do teste manual é o
 * que transforma "a tela respondeu" em "o efeito aconteceu".
 *
 * Mesmo padrão dos outros scripts de conferência do projeto (vb-cdi-check,
 * caixa-omie-probe): lê o .env.local, usa service role, não escreve nada.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = readFileSync(".env.local", "utf8");
const get = (k: string) => (env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "").trim();
const db = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

const BRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

const empresaArg = process.argv[2] ?? "Teste Módulo Orçamento";
const ano = Number(process.argv[3] ?? 2027);

async function main() {
  const { data: empresa } = await db
    .from("companies")
    .select("id, name")
    .ilike("name", empresaArg)
    .maybeSingle();
  if (!empresa) {
    console.error(`Empresa não encontrada: ${empresaArg}`);
    process.exit(1);
  }
  const companyId = empresa.id as string;
  console.log(`\n══ ${empresa.name} · ${ano} ══\n`);

  // ── 1. O ciclo ────────────────────────────────────────────────────────────
  const { data: ciclo } = await db
    .from("orcamento_ciclos")
    .select("id, estado, rodada, enviado_em, validado_em, publicado_em")
    .eq("company_id", companyId)
    .eq("year", ano)
    .maybeSingle();

  if (!ciclo) {
    console.log("CICLO: não iniciado (tudo se comporta como 'em construção').");
  } else {
    console.log(`CICLO: ${ciclo.estado}  ·  rodada ${ciclo.rodada}`);
    const quando = (r: unknown) =>
      r ? new Date(r as string).toLocaleString("pt-BR") : "—";
    console.log(`  enviado: ${quando(ciclo.enviado_em)}`);
    console.log(`  validado: ${quando(ciclo.validado_em)}`);
    console.log(`  publicado: ${quando(ciclo.publicado_em)}`);

    const { data: entregas } = await db
      .from("orcamento_setor_entregas")
      .select("setor_id, rodada, entregue_em, orcamento_setores(name)")
      .eq("ciclo_id", ciclo.id as string);
    const daRodada = (entregas ?? []).filter((e) => e.rodada === ciclo.rodada);
    console.log(
      `  entregas (rodada ${ciclo.rodada}): ${daRodada.length ? daRodada
        .map((e) => (e.orcamento_setores as { name?: string } | null)?.name ?? "?")
        .join(", ") : "nenhuma"}`,
    );
  }

  // ── 2. Versões congeladas ─────────────────────────────────────────────────
  const { data: versoes } = await db
    .from("orcamento_versoes")
    .select("id, numero, tipo, total_ano, criada_em")
    .eq("company_id", companyId)
    .eq("year", ano)
    .order("numero", { ascending: true });

  console.log(`\nVERSÕES CONGELADAS: ${versoes?.length ?? 0}`);
  if (!versoes?.length) {
    console.log("  (nenhuma — só aparecem ao enviar para validação e ao concluir)");
  }
  for (const v of versoes ?? []) {
    const { count } = await db
      .from("orcamento_versao_linhas")
      .select("*", { count: "exact", head: true })
      .eq("versao_id", v.id as string);
    console.log(
      `  #${v.numero} ${String(v.tipo).padEnd(10)} ${BRL(Number(v.total_ano))}  ` +
        `· ${count} linha(s) · ${new Date(v.criada_em as string).toLocaleString("pt-BR")}`,
    );
  }

  // O comparativo da fase F depende destas duas pontas existirem.
  const construcao = (versoes ?? []).find((v) => v.tipo === "construcao");
  const final = [...(versoes ?? [])].reverse().find((v) => v.tipo === "final");
  if (construcao && final) {
    const de = Number(construcao.total_ano);
    const para = Number(final.total_ano);
    const d = para - de;
    console.log(
      `\n  COMPARATIVO construção → aprovado: ${BRL(de)} → ${BRL(para)} ` +
        `(${d >= 0 ? "+" : "−"}${BRL(Math.abs(d))}` +
        `${de ? `, ${((d / de) * 100).toFixed(1).replace(".", ",")}%` : ""})`,
    );
  } else {
    console.log(
      `\n  COMPARATIVO: ${construcao ? "" : "falta a versão 'construcao' "}` +
        `${final ? "" : "falta a versão 'final' "}— as duas pontas aparecem ao enviar e ao concluir.`,
    );
  }

  // ── 3. A trilha ───────────────────────────────────────────────────────────
  const { data: trilha } = await db
    .from("orcamento_alteracoes")
    .select("acao, fase, resolucao, alvo_rotulo, motivo, autor_papel, created_at")
    .eq("company_id", companyId)
    .eq("year", ano)
    .order("created_at", { ascending: false });

  console.log(`\nTRILHA: ${trilha?.length ?? 0} registro(s)`);
  const porFase = new Map<string, number>();
  const porAcao = new Map<string, number>();
  for (const t of trilha ?? []) {
    porFase.set(t.fase as string, (porFase.get(t.fase as string) ?? 0) + 1);
    porAcao.set(t.acao as string, (porAcao.get(t.acao as string) ?? 0) + 1);
  }
  if (porFase.size) {
    console.log("  por fase: " + Array.from(porFase).map(([k, v]) => `${k}=${v}`).join("  "));
    console.log("  por ação: " + Array.from(porAcao).map(([k, v]) => `${k}=${v}`).join("  "));
  }
  const pendentes = (trilha ?? []).filter((t) => t.resolucao === "pendente");
  if (pendentes.length) {
    console.log(`  PENDÊNCIAS EM ABERTO: ${pendentes.length}`);
    for (const p of pendentes.slice(0, 8)) {
      console.log(`    · ${p.acao} "${p.alvo_rotulo ?? "?"}" — ${p.motivo ?? "sem motivo"}`);
    }
  }
  console.log("  últimas 5:");
  for (const t of (trilha ?? []).slice(0, 5)) {
    console.log(
      `    ${new Date(t.created_at as string).toLocaleString("pt-BR")} · ` +
        `${t.autor_papel ?? "?"} ${t.acao} "${t.alvo_rotulo ?? "—"}"` +
        `${t.motivo ? ` — "${t.motivo}"` : ""}`,
    );
  }

  // ── 4. Itens travados e cancelados ────────────────────────────────────────
  console.log("\nESTADO DOS ITENS");
  for (const [rot, tab] of [
    ["colaboradores", "orcamento_pessoal_colaboradores"],
    ["contratos (valor fixo)", "orcamento_valor_fixo_categorias"],
    ["linhas por média", "orcamento_media_categorias"],
  ] as const) {
    const { count: travados } = await db
      .from(tab)
      .select("*", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("year", ano)
      .eq("diretoria_travado", true);
    let extra = "";
    if (tab === "orcamento_pessoal_colaboradores") {
      const { count: cancelados } = await db
        .from(tab)
        .select("*", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("year", ano)
        .not("cancelado_em", "is", null);
      extra = `, ${cancelados} cancelado(s)`;
    }
    console.log(`  ${rot}: ${travados} travado(s)${extra}`);
  }
  // Planejamento: a trava é por categoria × setor; o cancelamento vive no jsonb.
  const { data: ps, error: psErr } = await db
    .from("orcamento_planejamento_socios")
    .select("category_code, proposta, proposta_confirmada, diretoria_travado")
    .eq("company_id", companyId)
    .eq("year", ano);
  // Erro de consulta NÃO pode virar "0": foi assim que a coluna ausente
  // (diretoria_travado em orcamento_planejamento_socios) passou despercebida —
  // o script dizia "0 de 0 itens" e parecia um dado, não uma falha.
  if (psErr) {
    console.log(`  planejamento: ERRO na consulta — ${psErr.code}: ${psErr.message}`);
  }
  let itensCancelados = 0;
  let itensTotal = 0;
  for (const r of ps ?? []) {
    if (r.proposta_confirmada !== true) continue;
    const itens = ((r.proposta as { itens?: unknown } | null)?.itens ?? []) as Record<
      string,
      unknown
    >[];
    itensTotal += itens.length;
    itensCancelados += itens.filter((i) => i.cancelado === true).length;
  }
  if (!psErr) {
    const psTravados = (ps ?? []).filter((r) => r.diretoria_travado).length;
    console.log(
      `  planejamento: ${psTravados} categoria(s) travada(s), ` +
        `${itensCancelados} de ${itensTotal} item(ns) cancelado(s)`,
    );
  }

  // ── 5. O que foi para o Budget e Forecast ────────────────────────────────
  console.log("\nBUDGET E FORECAST");
  const { data: raw } = await db
    .from("budget_uploads_raw")
    .select("source, amount")
    .eq("company_id", companyId)
    .eq("year", ano);
  const porSource = new Map<string, { linhas: number; total: number }>();
  for (const r of raw ?? []) {
    const k = (r.source as string) ?? "(sem source)";
    const acc = porSource.get(k) ?? { linhas: 0, total: 0 };
    acc.linhas += 1;
    acc.total += Number(r.amount ?? 0);
    porSource.set(k, acc);
  }
  if (porSource.size === 0) console.log("  budget_uploads_raw: vazio");
  for (const [k, v] of porSource) {
    console.log(`  raw source='${k}': ${v.linhas} linha(s), ${BRL(v.total)}`);
  }
  if (porSource.has("orcamento") && porSource.has("planilha")) {
    console.log(
      "  ⚠ ATENÇÃO: 'orcamento' e 'planilha' convivem neste ano — os dois SOMAM em budget_entries.",
    );
  }
  if (porSource.has("orcamento") && porSource.has("pessoal")) {
    console.log(
      "  ⚠ ATENÇÃO: sobrou 'pessoal' junto de 'orcamento' — a folha contaria duas vezes.",
    );
  }

  const { data: entries } = await db
    .from("budget_entries")
    .select("amount")
    .eq("company_id", companyId)
    .eq("year", ano);
  const totalEntries = (entries ?? []).reduce((a, e) => a + Number(e.amount ?? 0), 0);
  console.log(`  budget_entries: ${entries?.length ?? 0} célula(s), ${BRL(totalEntries)}`);

  // Invariante que importa: o publicado tem de bater com a versão final.
  const rawOrcamento = porSource.get("orcamento");
  if (final && rawOrcamento) {
    const dif = Math.abs(Number(final.total_ano) - rawOrcamento.total);
    console.log(
      `\n  CONFERÊNCIA versão final × publicado: ${BRL(Number(final.total_ano))} × ` +
        `${BRL(rawOrcamento.total)} → diferença ${BRL(dif)} ${dif < 1 ? "✓" : "✗ INVESTIGAR"}`,
    );
  }

  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
