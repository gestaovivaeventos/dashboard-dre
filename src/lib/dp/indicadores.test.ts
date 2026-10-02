import assert from "node:assert/strict";
import { test } from "node:test";

import { calcularIndicadores, grupoContrato, SEM_EMPRESA, ultimos12Meses, type DpIndicadorEntrada } from "@/lib/dp/indicadores";

const r = (p: Partial<DpIndicadorEntrada>): DpIndicadorEntrada => ({
  ativo: true, companyName: "Spot", tipoContrato: "CLT", salario: 3000, dataAdmissao: "2025-10-02",
  dataDesligamento: null, desligadoDetectadoEm: null, ...p,
});

test("grupoContrato: rótulos da Sólides, com e sem acento", () => {
  assert.equal(grupoContrato("CLT"), "clt");
  assert.equal(grupoContrato("Sócio"), "socio");
  assert.equal(grupoContrato("Prestador de Serviço"), "prestador");
  assert.equal(grupoContrato("Estagiário"), "estagio");
  assert.equal(grupoContrato("Jovem Aprendiz"), "estagio");
  assert.equal(grupoContrato(null), "outro");
});

test("ultimos12Meses termina no mês corrente e atravessa o ano", () => {
  const m = ultimos12Meses("2026-10-02");
  assert.equal(m.length, 12);
  assert.equal(m[0], "2025-11");
  assert.equal(m[11], "2026-10");
});

test("salário médio só de CLT; sem salário fica fora da folha e é contado", () => {
  const ind = calcularIndicadores(
    [r({ salario: 3000 }), r({ salario: 5000 }), r({ tipoContrato: "Sócio", salario: 30000 }), r({ salario: null })],
    "2026-10-02",
  );
  const spot = ind.porEmpresa[0];
  assert.equal(spot.ativos, 4);
  assert.equal(spot.folha, 38000);
  assert.equal(spot.semSalario, 1);
  assert.equal(spot.salarioMedioClt, 4000);
  assert.equal(spot.porContrato.socio, 1);
});

test("desligado não entra no quadro; Sem empresa vai por último; total soma tudo", () => {
  const ind = calcularIndicadores(
    [
      r({ companyName: null }),
      r({ companyName: "Spot" }),
      r({ companyName: "Spot", ativo: false, dataDesligamento: "2026-09-30" }),
      r({ companyName: "Express" }),
      r({ companyName: "Express" }),
    ],
    "2026-10-02",
  );
  assert.deepEqual(ind.porEmpresa.map((l) => [l.empresa, l.ativos]), [["Express", 2], ["Spot", 1], [SEM_EMPRESA, 1]]);
  assert.equal(ind.total.ativos, 4);
  assert.equal(ind.desligados12m, 1);
});

test("admissão futura não entra no gráfico nem no tempo de casa", () => {
  const ind = calcularIndicadores(
    [r({ dataAdmissao: "2026-09-15" }), r({ dataAdmissao: "2026-11-01" }), r({ dataAdmissao: "2020-01-01" })],
    "2026-10-02",
  );
  assert.equal(ind.admissoesPorMes.find((m) => m.mes === "2026-09")?.quantidade, 1);
  assert.equal(ind.admissoesPorMes.reduce((s, m) => s + m.quantidade, 0), 1);
  assert.equal(ind.total.admitidos12m, 1);
  assert.ok(ind.total.tempoMedioMeses !== null && ind.total.tempoMedioMeses > 40);
});
