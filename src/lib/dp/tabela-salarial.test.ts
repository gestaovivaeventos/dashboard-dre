import assert from "node:assert/strict";
import { test } from "node:test";

import {
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
    ["Salário", "Cargo", "Step", "Setor"],
    [4000, "Analista Comercial", "Pleno I", "Comercial"],
    ["", "", "", ""],
    ["R$ 2.500,00", "Motorista", "", "Operacional"],
  ]);
  assert.ok("ok" in r);
  if (!("ok" in r)) return;
  assert.deepEqual(r.ok.linhas.map((l) => [l.linha, l.setor, l.cargo, l.step, l.salario]), [
    [4, "Comercial", "Analista Comercial", "Pleno I", 4000],
    [6, "Operacional", "Motorista", "", 2500],
  ]);
  assert.deepEqual(r.ok.problemas, []);
});

test("parse: falha por LINHA, nunca pelo arquivo", () => {
  const r = parseTabelaPlanilha([
    ["Setor", "Cargo", "Step", "Salário"],
    ["TI", "", "I", 3000],
    ["TI", "Dev", "I", ""],
    ["TI", "Dev", "I", 3000],
    ["ti", "dev", "i", 3200],
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
  assert.ok("erro" in parseTabelaPlanilha([["Setor", "Step"]]));
  assert.ok("ok" in parseTabelaPlanilha([["Função", "Valor"]]));
});

test("importação: atualiza, insere e MANTÉM o que ficou fora da planilha", () => {
  const plano = planejarImportacao(
    [
      { linha: 2, setor: "Comercial", cargo: "Analista", step: "I", salario: 4200 },
      { linha: 3, setor: "Comercial", cargo: "Analista", step: "II", salario: 5000 },
      { linha: 4, setor: "comercial", cargo: "ANALISTA", step: "III", salario: 6000 },
    ],
    [
      { id: "a", setor: "Comercial", cargo: "Analista", step: "I", salario: 4000 },
      { id: "b", setor: "Comercial", cargo: "Analista", step: "II", salario: 5000 },
      { id: "c", setor: "TI", cargo: "Dev", step: "", salario: 7000 },
    ],
  );
  assert.deepEqual(plano.atualizar, [{ id: "a", salario: 4200, de: 4000 }]);
  assert.deepEqual(plano.inserir.map((l) => l.step), ["III"]);
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
