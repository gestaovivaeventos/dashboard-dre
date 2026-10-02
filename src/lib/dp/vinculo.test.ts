import assert from "node:assert/strict";
import { test } from "node:test";

import { alertasExperiencia, periodosExperiencia, resolverCentroCusto, resolverLinha } from "@/lib/dp/vinculo";

test("linha: exceção vence o cargo; sem os dois, nada", () => {
  assert.deepEqual(resolverLinha({ excecaoLinhaId: "x", linhaDoCargoId: "c" }), { linhaId: "x", origem: "excecao" });
  assert.deepEqual(resolverLinha({ excecaoLinhaId: null, linhaDoCargoId: "c" }), { linhaId: "c", origem: "cargo" });
  assert.deepEqual(resolverLinha({ excecaoLinhaId: null, linhaDoCargoId: null }), { linhaId: null, origem: null });
});

test("centro de custo: exceção vence o padrão da linha", () => {
  assert.deepEqual(resolverCentroCusto({ excecaoCentroId: "e", centroDaLinhaId: "l" }), { centroId: "e", origem: "excecao" });
  assert.deepEqual(resolverCentroCusto({ excecaoCentroId: null, centroDaLinhaId: "l" }), { centroId: "l", origem: "linha" });
});

test("experiência 2 x 45: fim do 1º = data da Sólides; prorrogação = + 45", () => {
  assert.deepEqual(
    periodosExperiencia({ tipoContrato: "CLT", admissao: "2026-09-01", experienciaFim: "2026-10-16", duracao: "2 x 45 dias" }),
    [
      { numero: 1, fim: "2026-10-16" },
      { numero: 2, fim: "2026-11-30" },
    ],
  );
});

test("experiência: sem data da Sólides, deriva da admissão; sem formato, só o 1º; não-CLT não tem", () => {
  assert.deepEqual(periodosExperiencia({ tipoContrato: "CLT", admissao: "2026-09-01", experienciaFim: null, duracao: "2 x 45 dias" })[0], {
    numero: 1,
    fim: "2026-10-16",
  });
  assert.equal(periodosExperiencia({ tipoContrato: "CLT", admissao: "2026-09-01", experienciaFim: "2026-10-16", duracao: null }).length, 1);
  assert.deepEqual(periodosExperiencia({ tipoContrato: "Sócio", admissao: "2026-09-01", experienciaFim: "2026-10-16", duracao: "2 x 45 dias" }), []);
  assert.deepEqual(periodosExperiencia({ tipoContrato: "CLT", admissao: null, experienciaFim: null, duracao: "Indeterminado" }), []);
});

test("alertas: só de hoje até 15 dias; desligado não entra; ordem pelo mais urgente", () => {
  const base = { tipoContrato: "CLT", admissao: "2026-09-01", duracao: "2 x 45 dias" };
  const r = alertasExperiencia(
    [
      { ...base, id: "a", nome: "Ana", ativo: true, experienciaFim: "2026-10-16" }, // 14 dias
      { ...base, id: "b", nome: "Bia", ativo: true, experienciaFim: "2026-10-02" }, // hoje
      { ...base, id: "c", nome: "Caio", ativo: true, experienciaFim: "2026-10-30" }, // 28 dias: fora
      { ...base, id: "d", nome: "Duda", ativo: false, experienciaFim: "2026-10-05" },
      { ...base, id: "e", nome: "Edu", ativo: true, experienciaFim: "2026-09-01" }, // 2º período vence 16/10
    ],
    "2026-10-02",
  );
  assert.deepEqual(r.map((x) => [x.id, x.periodo, x.diasRestantes]), [["b", 1, 0], ["a", 1, 14], ["e", 2, 14]]);
});
