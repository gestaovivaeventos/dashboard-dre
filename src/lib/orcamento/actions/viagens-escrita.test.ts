// Toda escrita de viagem é recortada por SETOR.
//
// A regra, pedida em 07/10/2026: o DIRETOR não edita viagem de outro setor — só o
// gestor do setor dela e o admin. Ela já valia, porque `setoresDeEscrita` trata o
// validador como construtor comum (restrito aos setores vinculados a ele), mas ela
// vale por uma CHAMADA dentro de cada action — e é disso que este teste cuida.
//
// Por que ler o arquivo do disco: o diretor LÊ a empresa inteira (`setoresDeLeitura`
// devolve `null` para ele), então uma action nova que esqueça o recorte de escrita
// COMPILA LIMPO, passa no lint e no build, e deixa ele gravar em qualquer setor —
// o defeito só apareceria com um diretor de verdade mexendo na viagem de outro
// setor. Não exercitamos a função (ela depende de sessão e banco): cobramos a
// chamada em toda action de escrita.
//
// Ao criar uma action de escrita nova, ou ela confere `podeEscreverNoSetor`, ou ela
// é admin-only (`SEM_ACESSO_ADMIN`). Não há terceira opção — e é este teste que
// cobra a escolha.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ARQUIVOS = ["viagens-grade.ts", "viagens.ts"];

/** Os verbos que criam, alteram ou apagam orçamento. Ler não entra. */
const VERBOS = [
  "salvar",
  "criar",
  "mover",
  "lancar",
  "remover",
  "enviar",
  "reabrir",
  "aplicar",
  "importar",
];

function corpoDasActions(arquivo: string): Array<{ nome: string; corpo: string }> {
  const texto = fs.readFileSync(path.join(process.cwd(), "src", "lib", "orcamento", "actions", arquivo), "utf8");
  // Cada bloco vai da declaração até a próxima `export `, que é onde a função
  // seguinte começa. Grosseiro de propósito: o que importa é não perder nenhuma.
  const partes = texto.split(/\nexport async function /).slice(1);
  return partes.map((parte) => {
    const nome = parte.slice(0, parte.indexOf("(")).trim();
    const fim = parte.indexOf("\nexport ");
    return { nome, corpo: fim === -1 ? parte : parte.slice(0, fim) };
  });
}

test("toda action de ESCRITA de viagem confere o setor, ou é admin-only", () => {
  const checadas: string[] = [];

  for (const arquivo of ARQUIVOS) {
    const actions = corpoDasActions(arquivo);
    assert.ok(actions.length > 0, `${arquivo}: não achei nenhuma action`);

    for (const { nome, corpo } of actions) {
      const escreve = VERBOS.some((v) => nome.toLowerCase().startsWith(v));
      if (!escreve) continue;
      checadas.push(`${arquivo}:${nome}`);

      const recortaSetor = corpo.includes("podeEscreverNoSetor");
      const soAdmin = corpo.includes("SEM_ACESSO_ADMIN");
      assert.ok(
        recortaSetor || soAdmin,
        `${arquivo}: ${nome} grava sem recortar por setor nem exigir admin — o diretor ` +
          "alcançaria viagem de outro setor, porque ele LÊ a empresa inteira.",
      );
    }
  }

  // Se este número cair, alguma action de escrita saiu do radar do teste (nome que
  // não começa por um dos verbos, por exemplo) em vez de o módulo ter encolhido.
  assert.ok(
    checadas.length >= 8,
    `esperava ao menos 8 actions de escrita, achei ${checadas.length}: ${checadas.join(", ")}`,
  );
});

test("lançar os valores da cotação é da CONTROLADORIA, não do gestor do setor", () => {
  // Quem cota é o admin: o valor vem de fora, e o gestor do setor não o digita nem
  // no próprio setor. Por isso aqui o gate é admin, não o recorte de setor.
  const lancar = corpoDasActions("viagens-grade.ts").find((a) => a.nome === "lancarValoresViagens");
  assert.ok(lancar, "lancarValoresViagens não existe mais");
  assert.match(lancar!.corpo, /SEM_ACESSO_ADMIN/);
});

test("toda action de escrita de viagem respeita a TRAVA de finalização", () => {
  // Finalizar faz duas coisas: publica no Budget o que a diretoria aprovou e
  // TRAVA a fatia para todo mundo — inclusive para o admin que clicou. É a
  // diferença deliberada para a trava da validação, onde admin e diretoria sempre
  // passam: finalizar é um fecho, não uma alçada. Caminho de escrita que esqueça a
  // conferência publica um número no Budget e deixa a origem dele mudar depois,
  // sem nada avisar.
  for (const { nome, corpo } of corpoDasActions("viagens-grade.ts")) {
    const escreve = VERBOS.some((v) => nome.toLowerCase().startsWith(v));
    if (!escreve) continue;
    assert.ok(
      corpo.includes("fechadas") || corpo.includes("travaDeFinalizacao"),
      `${nome} grava sem conferir a fatia finalizada.`,
    );
  }
});

