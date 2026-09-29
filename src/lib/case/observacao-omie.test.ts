import test from "node:test";
import assert from "node:assert/strict";

import { buildObservacaoReceber, type ObsContrato, type ObsTitulo } from "./observacao-omie";

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
  assert.match(obs, /Contrato Case nº 42 — parcela 1\/2/);
  assert.match(obs, /Fundo: Formatura Medicina UFMG 2026/);
  assert.match(obs, /12\/12\/2026 às 23h/);
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
  assert.match(obs, /- Comissão Comercial - Externa — Minas Fest: R\$ 500,00 venc\. 13\/12\/2026/);
  assert.match(obs, /BV Case \(recebido − saídas\): R\$ 3\.500,00/);
  assert.doesNotMatch(obs.split("COMISSÕES")[0], /Minas Fest/);
});

test("evento sem data não quebra a linha", () => {
  const obs = buildObservacaoReceber({ ...base, event_date: null, show_time: null, local_name: null, local_city: null }, receber1);
  assert.match(obs, /Evento: Baile de Gala — data a definir\n/);
});
