import assert from "node:assert/strict";
import { test } from "node:test";

import { isFornecedorTag, planSupplierImport } from "./omie-suppliers-import";
import type { OmiePartner } from "@/lib/omie/clientes";

function partner(over: Partial<OmiePartner>): OmiePartner {
  return {
    omie_codigo: 1,
    name: "Fornecedor X",
    cnpj_cpf: "12.345.678/0001-90",
    pessoa_fisica: false,
    email: null,
    phone: null,
    banco: null,
    agencia: null,
    conta_corrente: null,
    titular_banco: null,
    doc_titular: null,
    chave_pix: null,
    transf_padrao: false,
    endereco: null,
    cidade_estado: null,
    cep: null,
    tags: ["Fornecedor"],
    ...over,
  };
}

const EMPTY = { orgId: "org1", createdBy: "u1", existingDocs: new Set<string>(), existingOmieIds: new Set<string>() };

test("isFornecedorTag: só 'Fornecedor', ignora acento/caixa, aceita múltiplas tags", () => {
  assert.equal(isFornecedorTag(["Fornecedor"]), true);
  assert.equal(isFornecedorTag(["fornecedor"]), true);
  assert.equal(isFornecedorTag(["Cliente", "Fornecedor"]), true);
  assert.equal(isFornecedorTag(["Cliente"]), false);
  assert.equal(isFornecedorTag(["Prestador Dentro do Município"]), false);
  assert.equal(isFornecedorTag(["Transportadora"]), false);
  assert.equal(isFornecedorTag([]), false);
});

test("só os marcados como Fornecedor entram", () => {
  const res = planSupplierImport(
    [
      partner({ omie_codigo: 1, cnpj_cpf: "11111111000111", tags: ["Fornecedor"] }),
      partner({ omie_codigo: 2, cnpj_cpf: "22222222000122", tags: ["Cliente"] }),
      partner({ omie_codigo: 3, cnpj_cpf: "33333333000133", tags: ["Transportadora"] }),
      partner({ omie_codigo: 4, cnpj_cpf: "44444444000144", tags: ["Cliente", "Fornecedor"] }),
    ],
    EMPTY,
  );
  assert.equal(res.fornecedorCount, 2);
  assert.equal(res.rows.length, 2);
  assert.deepEqual(res.rows.map((r) => r.omie_id).sort(), [1, 4]);
});

test("a linha é pendente, from_omie, não precisa de sync e leva PIX + banco", () => {
  const [row] = planSupplierImport(
    [partner({ chave_pix: "pix@x.com", banco: "336", agencia: "0001", conta_corrente: "123-4", titular_banco: "X", doc_titular: "11111111000111", transf_padrao: true })],
    EMPTY,
  ).rows;
  assert.equal(row.status, "pendente");
  assert.equal(row.from_omie, true);
  assert.equal(row.omie_sync_required, false);
  assert.equal(row.org_id, "org1");
  assert.equal(row.created_by, "u1");
  assert.equal(row.chave_pix, "pix@x.com");
  assert.equal(row.banco, "336");
  assert.equal(row.conta_corrente, "123-4");
  assert.equal(row.transf_padrao, true);
});

test("dedup por documento contra o que já existe (normalização = índice único)", () => {
  const res = planSupplierImport(
    [partner({ omie_codigo: 9, cnpj_cpf: "12.345.678/0001-90" })],
    { ...EMPTY, existingDocs: new Set(["12345678000190"]) },
  );
  assert.equal(res.fornecedorCount, 1);
  assert.equal(res.skippedExisting, 1);
  assert.equal(res.rows.length, 0);
});

test("dedup dentro da própria lista (mesmo documento em dois CNPJs da empresa)", () => {
  const res = planSupplierImport(
    [
      partner({ omie_codigo: 1, cnpj_cpf: "12.345.678/0001-90" }),
      partner({ omie_codigo: 2, cnpj_cpf: "12345678000190" }),
    ],
    EMPTY,
  );
  assert.equal(res.rows.length, 1);
  assert.equal(res.skippedExisting, 1);
});

test("sem documento (estrangeiro): dedup por código Omie", () => {
  const res = planSupplierImport(
    [
      partner({ omie_codigo: 7, cnpj_cpf: null }),
      partner({ omie_codigo: 7, cnpj_cpf: null }), // mesmo código → ignora
      partner({ omie_codigo: 8, cnpj_cpf: null }), // outro → entra
    ],
    { ...EMPTY, existingOmieIds: new Set<string>() },
  );
  assert.equal(res.rows.length, 2);
  assert.equal(res.skippedExisting, 1);
  // E dois sem documento NÃO colidem entre si por doc vazio.
  assert.deepEqual(res.rows.map((r) => r.omie_id).sort(), [7, 8]);
});
