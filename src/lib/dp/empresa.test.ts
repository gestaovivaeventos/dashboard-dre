import assert from "node:assert/strict";
import { test } from "node:test";

import { indexarRegras, origensParaMapear, resolverEmpresa } from "@/lib/dp/empresa";

const idx = indexarRegras([
  { origem: "unidade", solidesId: 1, companyId: "spot" },
  { origem: "departamento", solidesId: 10, companyId: "franq" },
  { origem: "departamento", solidesId: 11, companyId: "outra" },
]);

test("unidade com regra decide", () => {
  assert.deepEqual(resolverEmpresa({ unidadeId: 1, departamentoId: 11 }, idx), { companyId: "spot", via: "unidade" });
});

test("unidade SEM regra não cai no departamento", () => {
  assert.deepEqual(resolverEmpresa({ unidadeId: 2, departamentoId: 10 }, idx), {
    companyId: null,
    motivo: "unidade_sem_regra",
  });
});

test("sem unidade, o departamento decide", () => {
  assert.deepEqual(resolverEmpresa({ unidadeId: null, departamentoId: 10 }, idx), { companyId: "franq", via: "departamento" });
  assert.equal(resolverEmpresa({ unidadeId: null, departamentoId: 99 }, idx).companyId, null);
  assert.deepEqual(resolverEmpresa({ unidadeId: null, departamentoId: null }, idx), {
    companyId: null,
    motivo: "sem_unidade_nem_departamento",
  });
});

test("origensParaMapear: unidades primeiro, pendentes antes das mapeadas; depto só de quem não tem unidade", () => {
  const out = origensParaMapear(
    [
      { unidadeId: 1, unidadeNome: "SPOT", departamentoId: 11, departamentoNome: "X", ativo: true },
      { unidadeId: 2, unidadeNome: "MINAS FEST", departamentoId: null, departamentoNome: null, ativo: true },
      { unidadeId: null, unidadeNome: null, departamentoId: 10, departamentoNome: "TI - FRANQUEADORA", ativo: true },
      { unidadeId: null, unidadeNome: null, departamentoId: 10, departamentoNome: "TI - FRANQUEADORA", ativo: false },
    ],
    [{ origem: "unidade", solidesId: 1, companyId: "spot", solidesNome: "SPOT" }],
  );
  assert.deepEqual(
    out.map((o) => [o.origem, o.nome, o.colaboradores, o.companyId]),
    [
      ["unidade", "MINAS FEST", 1, null],
      ["unidade", "SPOT", 1, "spot"],
      ["departamento", "TI - FRANQUEADORA", 1, null],
    ],
  );
});
