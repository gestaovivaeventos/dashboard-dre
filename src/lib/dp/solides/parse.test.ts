import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCpf, parseDataBR, parseDetail, parseListItem, parseMoedaBR } from "@/lib/dp/solides/parse";

test("parseDataBR: DD/MM/AAAA → ISO; vazio e data impossível → null", () => {
  assert.equal(parseDataBR("17/08/2026"), "2026-08-17");
  assert.equal(parseDataBR(""), null);
  assert.equal(parseDataBR(null), null);
  assert.equal(parseDataBR("31/02/2026"), null);
  assert.equal(parseDataBR("2026-08-17"), null);
});

test("parseMoedaBR: R$ 0,00 é 'não informado', não zero", () => {
  assert.equal(parseMoedaBR("R$ 3.500,00"), 3500);
  assert.equal(parseMoedaBR("R$ 12.345,67"), 12345.67);
  assert.equal(parseMoedaBR("R$ 0,00"), null);
  assert.equal(parseMoedaBR(""), null);
  assert.equal(parseMoedaBR("abc"), null);
});

test("parseCpf: só 11 dígitos", () => {
  assert.equal(parseCpf("123.456.789-01"), "12345678901");
  assert.equal(parseCpf("1234"), null);
});

test("parseListItem: referências vazias viram null, e-mail em minúsculas", () => {
  const row = parseListItem({
    id: 7,
    name: " Fulana de Tal ",
    idNumber: "12345678901",
    email: "Fulana@Exemplo.com",
    dateAdmission: "01/10/2026",
    updated_at: "29/09/2026",
    senior: { id: 3, name: "Gestora" },
    department: { id: 407508, name: "TI - FRANQUEADORA" },
    position: null,
    unity: { id: null, name: null },
  });
  assert.equal(row.nome, "Fulana de Tal");
  assert.equal(row.email, "fulana@exemplo.com");
  assert.equal(row.unidade_id, null);
  assert.equal(row.departamento_id, 407508);
  assert.equal(row.cargo_id, null);
  assert.equal(row.data_admissao, "2026-10-01");
  assert.equal(row.solides_atualizado_em, "2026-09-29");
});

test("parseDetail: só os campos aprovados — nada bancário", () => {
  const ficha = parseDetail({
    id: 7,
    salary: "R$ 4.200,50",
    dateDismissal: "",
    address: { zipCode: "36.010-000", streetName: "Rua A", number: "10", city: { name: "Juiz de Fora", state: { initials: "MG" } } },
    documents: { idNumber: "12345678901" },
  });
  // Lista FECHADA do que a ficha grava: banco, RG, PIS, CTPS, filiação, férias e exames ficam de fora.
  assert.deepEqual(Object.keys(ficha).sort(), [
    "beneficios_solides",
    "data_desligamento",
    "dependentes",
    "endereco",
    "experiencia_duracao",
    "experiencia_fim",
    "salario",
  ]);
  assert.equal(ficha.salario, 4200.5);
  assert.equal(ficha.data_desligamento, null);
  assert.equal(ficha.endereco?.cep, "36010000");
  assert.equal(ficha.endereco?.uf, "MG");
  assert.equal(parseDetail({ id: 1, address: { zipCode: "" } }).endereco, null);
});

test("campos liberados em 02/10/2026: nascimento, experiência, dependentes (sem RG) e benefícios", () => {
  const base = parseListItem({ id: 1, name: "X", birthDate: "12/03/1990" });
  assert.equal(base.data_nascimento, "1990-03-12");
  const f = parseDetail({
    id: 1,
    contractExpirationDate: "15/10/2026",
    durationContract: "2 x 45 dias",
    dependents: [
      { name: "Zeca", IdNumber: "12345678901", birthDate: "01/02/2015", relationship: "Filho" },
      { name: "Ana", IdNumber: "", birthDate: "", relationship: "Cônjuge" },
      { name: "", IdNumber: "", birthDate: "", relationship: "" },
    ],
    benefits: [{ benefitName: "Vale Transporte", typeBenefit: "Transporte", value: "R$ 220,00", valueDiscount: "R$ 0,00", benefitAppliedAs: "monthly", discountOption: null }],
  });
  assert.equal(f.experiencia_fim, "2026-10-15");
  assert.equal(f.experiencia_duracao, "2 x 45 dias");
  assert.deepEqual(f.dependentes.map((d) => d.nome), ["Ana", "Zeca"]); // ordenado, vazio descartado
  assert.ok(!("rg" in f.dependentes[0]));
  assert.deepEqual(f.beneficios_solides[0], { nome: "Vale Transporte", tipo: "Transporte", valor: 220, desconto: 0, aplicadoComo: "monthly", opcaoDesconto: null });
  // Ficha sem nada: listas vazias, não null ("nunca lido" é outra coisa).
  const vazia = parseDetail({ id: 2 });
  assert.deepEqual([vazia.dependentes, vazia.beneficios_solides], [[], []]);
});
