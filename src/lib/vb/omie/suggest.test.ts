import assert from "node:assert/strict";
import { test } from "node:test";

import { VB_OMIE_COMPANY_ID, VB_OMIE_START_DATE } from "@/lib/vb/omie/config";
import {
  isCandidateMovement,
  matchesSupplier,
  normalizeTokens,
  prefillFromMovement,
  suggestCreditor,
  suggestKind,
} from "@/lib/vb/omie/suggest";
import type { VbCreditorOption, VbOmieMovement } from "@/lib/vb/types";

const CREDITORS: VbCreditorOption[] = [
  { id: "c-renato", name: "Renato", active: true },
  { id: "c-maria", name: "Maria Ap", active: true },
  { id: "c-pedro", name: "Pedro P", active: true },
  { id: "c-sotrate", name: "Sotrate", active: true },
  { id: "c-renan", name: "Renan", active: false },
];

function movement(over: Partial<VbOmieMovement> = {}): VbOmieMovement {
  return {
    id: "fe-1",
    omie_id: "mov:cc:1",
    payment_date: "2026-09-12",
    supplier_customer: "FERNANDO SOTRATE FERREIRA",
    description: "RESGATE VB",
    category_code: "2.05.03",
    category_name: "Pagamento de Empréstimos",
    value: 330000,
    document_number: null,
    ...over,
  };
}

test("normalizeTokens tira acento, caixa e pontuação", () => {
  assert.deepEqual(normalizeTokens("MARIA APARECIDA - CONTA BRADESCO"), ["maria", "aparecida", "conta", "bradesco"]);
  assert.deepEqual(normalizeTokens("Sotrate"), ["sotrate"]);
  assert.deepEqual(normalizeTokens(null), []);
});

test("matchesSupplier: cada token do credor é prefixo de um token distinto do fornecedor, na ordem", () => {
  assert.equal(matchesSupplier("Maria Ap", "MARIA APARECIDA GOMES ALMEIDA"), true);
  assert.equal(matchesSupplier("Sotrate", "FERNANDO SOTRATE FERREIRA"), true);
  assert.equal(matchesSupplier("Pedro P", "PEDRO PAULO"), true);
  // O "P" não pode reaproveitar o token PEDRO.
  assert.equal(matchesSupplier("Pedro P", "PEDRO HENRIQUE"), false);
  // Renan não é prefixo de RENATO.
  assert.equal(matchesSupplier("Renan", "RENATO MENEZES - BB Cc 18869"), false);
  assert.equal(matchesSupplier("Renato", null), false);
});

test("suggestCreditor: memória vence o nome", () => {
  const memory = { "FERNANDO SOTRATE FERREIRA": "c-renato" };
  assert.equal(suggestCreditor("FERNANDO SOTRATE FERREIRA", CREDITORS, memory), "c-renato");
  assert.equal(suggestCreditor("FERNANDO SOTRATE FERREIRA", CREDITORS, {}), "c-sotrate");
});

test("suggestCreditor: só ativos, ambíguo e sem fornecedor viram null", () => {
  assert.equal(suggestCreditor("RENAN SILVA", CREDITORS, {}), null);
  const twins: VbCreditorOption[] = [
    { id: "a", name: "Maria", active: true },
    { id: "b", name: "Maria Ap", active: true },
  ];
  assert.equal(suggestCreditor("MARIA APARECIDA", twins, {}), null);
  assert.equal(suggestCreditor(null, CREDITORS, {}), null);
  assert.equal(suggestCreditor("CEMIG D", CREDITORS, {}), null);
});

test("suggestKind segue o mapa por categoria e cai em saída", () => {
  assert.equal(suggestKind("2.05.03"), "saida");
  assert.equal(suggestKind("2.05.01"), "saida");
  assert.equal(suggestKind("2.10.98"), "entrada");
  assert.equal(suggestKind("2.03.98"), "saida");
  assert.equal(suggestKind(null), "saida");
});

test("isCandidateMovement: empresa, tipo e data inclusiva", () => {
  const base = { company_id: VB_OMIE_COMPANY_ID, type: "despesa", payment_date: VB_OMIE_START_DATE };
  assert.equal(isCandidateMovement(base), true);
  assert.equal(isCandidateMovement({ ...base, payment_date: "2026-09-09" }), false);
  assert.equal(isCandidateMovement({ ...base, type: "receita" }), false);
  assert.equal(isCandidateMovement({ ...base, company_id: "outra" }), false);
});

test("prefillFromMovement: data, descrição cortada, credor e tipo sugeridos, valor em string BR", () => {
  const long = "x".repeat(320);
  const result = prefillFromMovement(movement({ description: long, value: 1234.5 }), CREDITORS, {});
  assert.equal(result.date, "2026-09-12");
  assert.equal(result.description.length, 300);
  assert.deepEqual(result.lines, [{ creditorId: "c-sotrate", kind: "saida", amount: "1234,5" }]);
});

test("prefillFromMovement: sem sugestão usa o primeiro credor ativo; descrição nula vira vazia", () => {
  const result = prefillFromMovement(
    movement({ supplier_customer: "CEMIG D", description: null, category_code: "2.10.98", value: 5580.57 }),
    CREDITORS,
    {},
  );
  assert.equal(result.description, "");
  assert.deepEqual(result.lines, [{ creditorId: "c-renato", kind: "entrada", amount: "5580,57" }]);
});
