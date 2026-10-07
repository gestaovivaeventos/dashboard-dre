// O estado que a Prévia exige da viagem precisa EXISTIR.
//
// Em 07/10/2026 a Prévia filtrava `status = "enviada"` — o valor do desenho
// anterior, que a migration do fluxo (20261006120000) converteu para
// `aguardando_cotacao` e que o CHECK novo nem aceita. O efeito foi o pior possível:
// a consulta não dá erro, devolve ZERO linhas, e com isso nenhuma viagem entrava na
// Prévia, o total do setor saía menor sem motivo e o painel de validação não tinha
// viagem nenhuma para o diretor decidir. `tsc`, ESLint e build passam — é uma
// string.
//
// Por isso o teste lê o ARQUIVO do disco (padrão do `guard-metodo.test.ts`): ele
// não exercita a função, que depende de sessão e banco; ele cobra que todo estado
// comparado contra `orcamento_viagens` seja um dos cinco que a máquina produz.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { ESTADOS_VIAGEM } from "@/lib/viagens/fluxo";

const ARQUIVO = path.join(
  process.cwd(),
  "src",
  "lib",
  "orcamento",
  "actions",
  "previa-orcamento.ts",
);

/** O trecho da consulta que lê as viagens, da tabela até o fim da expressão. */
function consultaDasViagens(): string {
  const texto = fs.readFileSync(ARQUIVO, "utf8");
  const i = texto.indexOf('.from("orcamento_viagens")');
  assert.notEqual(i, -1, "a Prévia deixou de ler orcamento_viagens");
  const fim = texto.indexOf(";", i);
  return texto.slice(i, fim === -1 ? undefined : fim);
}

test("a Prévia filtra a viagem por um estado que a máquina produz", () => {
  const consulta = consultaDasViagens();

  // `matchAll` precisaria de downlevelIteration no target deste projeto.
  const estados: string[] = [];
  const umPorVez = /\.eq\("status",\s*"([^"]+)"\)/g;
  let m = umPorVez.exec(consulta);
  while (m) {
    estados.push(m[1]);
    m = umPorVez.exec(consulta);
  }
  const varios = /\.in\("status",\s*\[([^\]]*)\]\)/g;
  let n = varios.exec(consulta);
  while (n) {
    for (const bruto of n[1].split(",")) {
      const v = bruto.trim().replace(/^"|"$/g, "");
      if (v) estados.push(v);
    }
    n = varios.exec(consulta);
  }

  assert.ok(estados.length > 0, "a Prévia parou de filtrar por estado — ela somaria rascunho");
  for (const e of estados) {
    assert.ok(
      (ESTADOS_VIAGEM as readonly string[]).includes(e),
      `a Prévia filtra por "${e}", que não é um estado do fluxo — a consulta devolveria ` +
        "zero linhas sem erro nenhum, e a viagem sumiria do orçamento em silêncio.",
    );
  }
});

test("a Prévia NÃO soma viagem que ainda não foi à diretoria", () => {
  // Rascunho e as da Controladoria não têm número fechado, e `cotada` ainda está na
  // mão dela: deixá-la entrar ofereceria o ✓ no painel do setor a uma viagem que o
  // fluxo não liberou, e a prévia discordaria da máquina de estados sobre quem
  // decide.
  const consulta = consultaDasViagens();
  for (const fora of ["rascunho", "aguardando_cotacao", "em_cotacao", "cotada"]) {
    assert.doesNotMatch(
      consulta,
      new RegExp(`"${fora}"`),
      `a Prévia passou a somar viagem em "${fora}"`,
    );
  }
  assert.match(consulta, /"em_aprovacao"/);
});
