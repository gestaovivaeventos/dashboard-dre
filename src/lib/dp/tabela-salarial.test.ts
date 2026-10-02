import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cargoComStep,
  lerPercentual,
  lerSalario,
  ordemEntre,
  parseTabelaPlanilha,
  planejarImportacao,
  previaReajuste,
  reajustar,
} from "@/lib/dp/tabela-salarial";

test("lerSalario: número do Excel, texto BR e texto com ponto decimal", () => {
  assert.equal(lerSalario(3500), 3500);
  assert.equal(lerSalario("R$ 3.500,00"), 3500);
  assert.equal(lerSalario("3500,5"), 3500.5);
  assert.equal(lerSalario("3500.50"), 3500.5);
  assert.equal(lerSalario(""), null);
  assert.equal(lerSalario("a combinar"), null);
});

test("parse: acha o cabeçalho depois de um título, colunas em qualquer ordem", () => {
  const r = parseTabelaPlanilha([
    ["Tabela salarial — Spot"],
    [],
    ["Salário", "Cargo", "Setor"],
    [4000, "Analista Comercial 1", "Comercial"],
    ["", "", ""],
    ["R$ 2.500,00", "Motorista", "Operacional"],
  ]);
  assert.ok("ok" in r);
  if (!("ok" in r)) return;
  assert.deepEqual(r.ok.linhas.map((l) => [l.linha, l.setor, l.cargo, l.salario]), [
    [4, "Comercial", "Analista Comercial 1", 4000],
    [6, "Operacional", "Motorista", 2500],
  ]);
  assert.deepEqual(r.ok.problemas, []);
});

test("parse: planilha antiga com coluna Step — o step é JUNTADO ao cargo, não colide", () => {
  const r = parseTabelaPlanilha([
    ["Setor", "Cargo", "Step", "Salário"],
    ["Adm", "Auxiliar Administrativo", "1", 2000],
    ["Adm", "Auxiliar Administrativo", "2", 2200],
    ["Adm", "Motorista", "", 2500],
    ["Adm", "", "3", 2400],
  ]);
  assert.ok("ok" in r);
  if (!("ok" in r)) return;
  assert.deepEqual(r.ok.linhas.map((l) => l.cargo), ["Auxiliar Administrativo 1", "Auxiliar Administrativo 2", "Motorista"]);
  // Step sem cargo continua sendo linha sem cargo — não vira um cargo chamado "3".
  assert.deepEqual(r.ok.problemas, ["Linha 5: sem cargo."]);
  assert.equal(cargoComStep("Auxiliar", " 4 "), "Auxiliar 4");
  assert.equal(cargoComStep("Auxiliar", ""), "Auxiliar");
});

test("parse: falha por LINHA, nunca pelo arquivo", () => {
  const r = parseTabelaPlanilha([
    ["Setor", "Cargo", "Salário"],
    ["TI", "", 3000],
    ["TI", "Dev 1", ""],
    ["TI", "Dev 1", 3000],
    ["ti", "DEV 1", 3200],
  ]);
  assert.ok("ok" in r);
  if (!("ok" in r)) return;
  assert.equal(r.ok.linhas.length, 1);
  assert.equal(r.ok.problemas.length, 3);
  assert.match(r.ok.problemas[2], /repete a linha 4/);
});

test("parse: sem Cargo/Salário no cabeçalho é erro do arquivo", () => {
  // "Valor" é aceito como Salário, mas falta Cargo.
  assert.ok("erro" in parseTabelaPlanilha([["Nome", "Valor"]]));
  assert.ok("erro" in parseTabelaPlanilha([["Setor", "Cargo"]]));
  assert.ok("ok" in parseTabelaPlanilha([["Função", "Valor"]]));
});

test("importação: atualiza, insere e MANTÉM o que ficou fora da planilha", () => {
  const plano = planejarImportacao(
    [
      { linha: 2, setor: "Comercial", cargo: "Analista 1", salario: 4200 },
      { linha: 3, setor: "Comercial", cargo: "Analista 2", salario: 5000 },
      { linha: 4, setor: "comercial", cargo: "ANALISTA 3", salario: 6000 },
    ],
    [
      { id: "a", setor: "Comercial", cargo: "Analista 1", salario: 4000 },
      { id: "b", setor: "Comercial", cargo: "Analista 2", salario: 5000 },
      { id: "c", setor: "TI", cargo: "Dev", salario: 7000 },
    ],
  );
  assert.deepEqual(plano.atualizar, [{ id: "a", salario: 4200, de: 4000 }]);
  assert.deepEqual(plano.inserir.map((l) => l.cargo), ["ANALISTA 3"]);
  assert.equal(plano.iguais, 1);
  assert.equal(plano.foraDaPlanilha, 1);
});

test("reajuste: >= 0, teto de sanidade e arredondamento igual ao do banco", () => {
  assert.deepEqual(lerPercentual("5,5"), { ok: 5.5 });
  assert.deepEqual(lerPercentual("0"), { ok: 0 });
  assert.ok("erro" in lerPercentual("-2"));
  assert.ok("erro" in lerPercentual(""));
  assert.ok("erro" in lerPercentual("150"));
  assert.equal(reajustar(3333.33, 5), 3500);
  assert.deepEqual(previaReajuste([1000, 2000], 10), { linhas: 2, antes: 3000, depois: 3300 });
});

test("ordemEntre: pontas e meio", () => {
  assert.equal(ordemEntre(null, null), 1);
  assert.equal(ordemEntre(3, null), 4);
  assert.equal(ordemEntre(null, 3), 2);
  assert.equal(ordemEntre(1, 2), 1.5);
});
