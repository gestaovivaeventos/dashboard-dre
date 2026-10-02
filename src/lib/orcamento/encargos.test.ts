import assert from "node:assert/strict";
import { test } from "node:test";

import { encargosPadrao, fatorEncargos, resolverEncargos } from "@/lib/orcamento/encargos";

test("encargosPadrao: Simples só tem FGTS; os demais regimes, o pacote normal", () => {
  assert.deepEqual(encargosPadrao("simples_nacional"), { inss_patronal: 0, rat_fap: 0, terceiros: 0, fgts: 8 });
  assert.deepEqual(encargosPadrao("lucro_presumido"), { inss_patronal: 20, rat_fap: 2, terceiros: 5.8, fgts: 8 });
  assert.deepEqual(encargosPadrao(null), encargosPadrao("lucro_real"));
});

test("resolverEncargos: sem linha = padrão do regime; coluna nula = padrão daquele encargo", () => {
  assert.deepEqual(resolverEncargos(undefined, "simples_nacional"), { values: encargosPadrao("simples_nacional"), usandoPadrao: true });
  const r = resolverEncargos({ inss_patronal: 20, rat_fap: 3, terceiros: null, fgts: "8" }, "lucro_real");
  assert.equal(r.usandoPadrao, false);
  assert.deepEqual(r.values, { inss_patronal: 20, rat_fap: 3, terceiros: 5.8, fgts: 8 });
});

test("fatorEncargos: soma INSS (patronal + RAT + terceiros) e FGTS, em fração", () => {
  assert.ok(Math.abs(fatorEncargos(encargosPadrao("lucro_real")) - 0.358) < 1e-9);
});
