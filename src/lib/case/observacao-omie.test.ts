import test from "node:test";
import assert from "node:assert/strict";

import { buildObservacaoPagar, buildObservacaoReceber, type ObsContrato, type ObsTitulo } from "./observacao-omie";

const receber1: ObsTitulo = { leg: "receber_custodia", parcela_numero: 1, parcela_total: 2, vencimento: "2026-10-01", valor: 5000 };
const receber2: ObsTitulo = { leg: "receber_custodia", parcela_numero: 2, parcela_total: 2, vencimento: "2026-11-01", valor: 5000 };

const base: ObsContrato = {
  contract_number: 42,
  fundo: "Formatura Medicina UFMG 2026",
  event_name: "Baile de Gala",
  event_date: "2026-12-12",
  show_time: "23h",
  local_name: "Salão Terrazzo",
  local_city: "Belo Horizonte/MG",
  atracoes: ["Banda X", "DJ Y"],
  valor_atracao_cliente: 10000,
  valor_rider: 0,
  valor_camarim: 0,
  valor_extras: 0,
  titulos: [receber2, receber1],
};

test("traz sempre nº do contrato, fundo, data do evento e atrações", () => {
  const obs = buildObservacaoReceber(base, receber1);
  assert.match(obs, /Contrato Case nº 42 - parcela 1\/2/);
  assert.match(obs, /Fundo: Formatura Medicina UFMG 2026/);
  assert.match(obs, /Data do evento: 12\/12\/2026\nHorário: 23h\nLocal: Salão Terrazzo, Belo Horizonte\/MG/);
  assert.match(obs, /Atrações: Banda X, DJ Y/);
});

test("lista os recebimentos em ordem de vencimento com o total", () => {
  const obs = buildObservacaoReceber(base, receber1);
  assert.match(obs, /RECEBIMENTOS \(total R\$ 10\.000,00\)/);
  assert.ok(obs.indexOf("01/10/2026") < obs.indexOf("01/11/2026"));
});

test("sem saídas cadastradas não mostra BV (seria o contrato inteiro)", () => {
  const obs = buildObservacaoReceber(base, receber1);
  assert.doesNotMatch(obs, /BV Case/);
  assert.doesNotMatch(obs, /PAGAMENTOS/);
});

test("separa pagamentos de comissões e apura o BV como recebido − saídas", () => {
  const c: ObsContrato = {
    ...base,
    titulos: [
      receber1,
      receber2,
      { leg: "pagar_custodia", parcela_numero: 1, parcela_total: 2, vencimento: "2026-12-01", valor: 3000, parceiro: "Banda X" },
      { leg: "pagar_custodia", parcela_numero: 2, parcela_total: 2, vencimento: "2026-12-13", valor: 3000, parceiro: "Banda X" },
      { leg: "pagar_custodia", parcela_numero: 1, parcela_total: 1, vencimento: "2026-12-13", valor: 500, parceiro: "Minas Fest", fornecedor_tipo: "comissao_externa" },
    ],
  };
  const obs = buildObservacaoReceber(c, receber1);
  assert.match(obs, /PAGAMENTOS:\n- Atração Banda X: R\$ 6\.000,00 \(01\/12\/2026 R\$ 3\.000,00; 13\/12\/2026 R\$ 3\.000,00\)/);
  assert.match(obs, /- Comissão Comercial - Externa - Minas Fest: R\$ 500,00 venc\. 13\/12\/2026/);
  assert.match(obs, /BV Case \(recebido - saídas\): R\$ 3\.500,00/);
  assert.doesNotMatch(obs.split("COMISSÕES")[0], /Minas Fest/);
});

test("evento sem data não quebra a linha", () => {
  const obs = buildObservacaoReceber({ ...base, event_date: null, show_time: null, local_name: null, local_city: null }, receber1);
  assert.match(obs, /Evento: Baile de Gala\nData do evento: a definir\nAtrações/);
});

test("sem travessão: a Omie apaga o caractere", () => {
  assert.doesNotMatch(buildObservacaoReceber(base, receber1), /—|−/);
});

test("a pagar: nome da atração + favorecido, contrato e o cronograma só deste favorecido", () => {
  const p1: ObsTitulo = { leg: "pagar_custodia", parcela_numero: 1, parcela_total: 2, vencimento: "2026-12-01", valor: 3000, parceiro: "FORMULA 7 LTDA", atracao: "Banda Lucky", entidade: "a1" };
  const p2: ObsTitulo = { ...p1, parcela_numero: 2, vencimento: "2026-12-13" };
  const outro: ObsTitulo = { leg: "pagar_custodia", parcela_numero: 1, parcela_total: 1, vencimento: "2026-12-13", valor: 500, parceiro: "Minas Fest", fornecedor_tipo: "comissao_externa", entidade: "f1" };
  const c: ObsContrato = { ...base, titulos: [receber1, receber2, p1, p2, outro] };

  const obs = buildObservacaoPagar(c, p1);
  assert.match(obs, /^Contrato Case nº 42 - pagamento 1\/2\nAtração: Banda Lucky \(favorecido: FORMULA 7 LTDA\)\nFundo: /);
  assert.match(obs, /Data do evento: 12\/12\/2026/);
  assert.match(obs, /PAGAMENTOS A ESTE FAVORECIDO \(total R\$ 6\.000,00\):\n- 1\/2: R\$ 3\.000,00 venc\. 01\/12\/2026\n- 2\/2/);
  assert.doesNotMatch(obs, /Minas Fest|RECEBIMENTOS|BV Case/);

  assert.match(buildObservacaoPagar(c, outro), /\nComissão Comercial - Externa: Minas Fest\n/);
  // No a receber, a atração aparece pelo nome artístico.
  assert.match(buildObservacaoReceber(c, receber1), /- Atração Banda Lucky \(favorecido: FORMULA 7 LTDA\): R\$ 6\.000,00/);
});

test("a pagar sem nome artístico usa o cadastro, sem repetir", () => {
  const p: ObsTitulo = { leg: "pagar_custodia", parcela_numero: 1, parcela_total: 1, vencimento: "2026-12-01", valor: 100, parceiro: "LABANDA", entidade: "a2" };
  assert.match(buildObservacaoPagar({ ...base, titulos: [p] }, p), /\nAtração: LABANDA\n/);
});
