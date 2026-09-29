// A cópia dos benefícios do Plano de Cargos para o colaborador.
//
// O que estes testes travam é a distinção entre NULO e ZERO. Ela não é
// cosmética: nulo no plano preserva o que o administrador digitou na aba
// Benefícios, zero sobrescreve com "não recebe". Conflar os dois apagaria
// cadastro em silêncio no gesto mais comum da tela (escolher um cargo).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  beneficiosAoEscolherCargo,
  beneficiosQueMudam,
  beneficiosVazios,
  normalizarBeneficios,
  planoDefineAlgum,
  quantosDefinidos,
  somaBeneficios,
} from "./cargo-beneficios";
import { BENEFICIOS } from "./beneficios";

test("nível vazio não mexe em nada do colaborador", () => {
  const atuais = { vale_transporte: 300, assistencia_medica: 500 };
  const r = beneficiosAoEscolherCargo(atuais, beneficiosVazios());
  assert.equal(r.vale_transporte, 300);
  assert.equal(r.assistencia_medica, 500);
  assert.deepEqual(beneficiosQueMudam(atuais, beneficiosVazios()), []);
});

test("o que o plano define SOBRESCREVE o que estava digitado", () => {
  const r = beneficiosAoEscolherCargo(
    { vale_transporte: 300 },
    { vale_transporte: 450 },
  );
  assert.equal(r.vale_transporte, 450);
});

test("ZERO no plano sobrescreve — é 'não recebe', não 'não diz'", () => {
  const r = beneficiosAoEscolherCargo({ vale_transporte: 300 }, { vale_transporte: 0 });
  assert.equal(r.vale_transporte, 0);
  assert.deepEqual(beneficiosQueMudam({ vale_transporte: 300 }, { vale_transporte: 0 }), [
    "vale_transporte",
  ]);
});

test("NULO no plano preserva — o valor segue vindo da aba Benefícios", () => {
  const r = beneficiosAoEscolherCargo(
    { vale_transporte: 300, beneficio_gasolina: 200 },
    { vale_transporte: 450, beneficio_gasolina: null },
  );
  assert.equal(r.vale_transporte, 450);
  assert.equal(r.beneficio_gasolina, 200);
});

test("colaborador sem nada recebe o pacote do nível", () => {
  const r = beneficiosAoEscolherCargo(null, {
    vale_transporte: 300,
    assistencia_medica: 800,
  });
  assert.equal(r.vale_transporte, 300);
  assert.equal(r.assistencia_medica, 800);
  assert.equal(r.seguro_vida, null);
});

test("valor inválido ou negativo nunca entra", () => {
  const r = normalizarBeneficios({
    vale_transporte: -10,
    beneficio_gasolina: Number.NaN,
    refeicoes_empresa: 120,
  });
  assert.equal(r.vale_transporte, null);
  assert.equal(r.beneficio_gasolina, null);
  assert.equal(r.refeicoes_empresa, 120);
});

test("a soma ignora nulo, mas conta o zero", () => {
  assert.equal(somaBeneficios({ vale_transporte: 300, beneficio_gasolina: null }), 300);
  assert.equal(somaBeneficios({ vale_transporte: 300, beneficio_gasolina: 0 }), 300);
  assert.equal(somaBeneficios(beneficiosVazios()), 0);
});

test("quantosDefinidos conta o zero e não o nulo", () => {
  assert.equal(quantosDefinidos({ vale_transporte: 0, beneficio_gasolina: null }), 1);
  assert.equal(planoDefineAlgum({ vale_transporte: 0 }), true);
  assert.equal(planoDefineAlgum(beneficiosVazios()), false);
  assert.equal(planoDefineAlgum(null), false);
});

test("beneficiosVazios cobre o catálogo inteiro", () => {
  const vazios = beneficiosVazios();
  assert.equal(Object.keys(vazios).length, BENEFICIOS.length);
  for (const b of BENEFICIOS) assert.equal(vazios[b.key], null);
});

test("os SELECT de nível listam todas as colunas de benefício", () => {
  // O `select` do Supabase precisa ser string literal (o client analisa em
  // tempo de compilação), então não dá para montá-lo a partir de BENEFICIOS.
  // Um benefício novo esquecido num deles não quebra nada: o valor do plano
  // simplesmente nunca chega ao colaborador — em silêncio. Esta é a trava,
  // e vale para os DOIS leitores: o do Plano de Cargos e o do quadro.
  const fontes = [
    "src/lib/orcamento/actions/cargos.ts",
    "src/lib/orcamento/actions/pessoal.ts",
  ];
  for (const f of fontes) {
    const src = readFileSync(f, "utf8");
    const select = /"cargo_id, name, salario[^"]*"|"id, cargo_id, name, salario[^"]*"/.exec(src);
    // O primeiro select de nível de cada arquivo é o COM benefícios.
    const cols = (select?.[0] ?? "").split(",").map((c) => c.trim().replace(/"/g, ""));
    for (const b of BENEFICIOS) {
      assert.ok(cols.includes(b.key), `${f}: o select de nível não inclui "${b.key}"`);
    }
  }
});
