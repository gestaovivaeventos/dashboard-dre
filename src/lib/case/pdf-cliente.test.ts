import test from "node:test";
import assert from "node:assert/strict";

import { normalizePdfCliente, pdfClienteData } from "./pdf-cliente";

const cadastro = {
  name: "Comissão Medicina 2026",
  cnpj_cpf: "12345678000190",
  resp_legal: "Ana Souza",
  cpf_resp_legal: "11122233344",
  endereco: "Rua A, 1",
  cidade_estado: "Belo Horizonte/MG",
  cep: "30000000",
};

test("sem dados próprios, o PDF usa o cadastro", () => {
  const d = pdfClienteData(cadastro, null);
  assert.equal(d.fundo, "Comissão Medicina 2026");
  assert.equal(d.cnpj, "12345678000190");
  assert.equal(d.respLegal, "Ana Souza");
});

test("com dados próprios, o PDF usa só eles — campo em branco não herda do cadastro", () => {
  const d = pdfClienteData(cadastro, { name: "Fundo Medicina UFMG", cnpj_cpf: "", resp_legal: "Bruno Lima", cpf_resp_legal: null, endereco: null, cidade_estado: null, cep: null });
  assert.equal(d.fundo, "Fundo Medicina UFMG");
  assert.equal(d.respLegal, "Bruno Lima");
  assert.equal(d.cnpj, null);
  assert.equal(d.endereco, null);
});

test("dados próprios sem nome contam como 'mesmos dados'", () => {
  assert.equal(normalizePdfCliente({ name: "  ", cnpj_cpf: "1", resp_legal: null, cpf_resp_legal: null, endereco: null, cidade_estado: null, cep: null }), null);
  assert.equal(pdfClienteData(cadastro, { name: "" }).fundo, "Comissão Medicina 2026");
});

test("normaliza espaços e vazios", () => {
  const n = normalizePdfCliente({ name: " X ", cnpj_cpf: " ", resp_legal: " Y ", cpf_resp_legal: null, endereco: null, cidade_estado: null, cep: null });
  assert.deepEqual(n, { name: "X", cnpj_cpf: null, resp_legal: "Y", cpf_resp_legal: null, endereco: null, cidade_estado: null, cep: null });
});
