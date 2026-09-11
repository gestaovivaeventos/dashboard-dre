import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addAllActiveLines,
  buildEntryRows,
  newEntriesSchema,
  replicatedFrom,
  sumTypedLines,
  toggleCreditorLines,
  VB_MAX_ENTRY_LINES,
  type NewEntriesInput,
} from "./new-entries";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const CTX = {
  userId: "99999999-9999-4999-8999-999999999999",
  groupId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

function input(over: Partial<NewEntriesInput>): NewEntriesInput {
  return {
    entry_date: "2026-09-10",
    description: "Cessão de crédito",
    period_start: null,
    period_end: null,
    rate: null,
    rate_basis: null,
    lines: [],
    ...over,
  };
}

test("transferência entre credores: saída e entrada nascem no mesmo grupo, com o sinal do tipo", () => {
  const result = buildEntryRows(
    input({
      lines: [
        { creditor_id: A, kind: "saida", amount: 10000 },
        // Sinal digitado não manda: entrada é sempre positiva, saída sempre negativa.
        { creditor_id: B, kind: "entrada", amount: -10000 },
      ],
    }),
    CTX,
  );
  assert.ok("rows" in result, JSON.stringify(result));
  assert.equal(result.rows.length, 2);
  assert.deepEqual(
    result.rows.map((row) => [row.creditor_id, row.kind, row.amount, row.sort_order]),
    [
      [A, "saida", -10000, 0],
      [B, "entrada", 10000, 1],
    ],
  );
  for (const row of result.rows) {
    assert.equal(row.group_id, CTX.groupId);
    assert.equal(row.created_by, CTX.userId);
    assert.equal(row.status, "aprovado");
    assert.equal(row.entry_date, "2026-09-10");
    assert.equal(row.description, "Cessão de crédito");
    assert.equal(row.period_start, null);
    assert.equal(row.period_end, null);
    assert.equal(row.days, null);
    assert.equal(row.rate, null);
    assert.equal(row.rate_basis, null);
    assert.deepEqual(row.flags, []);
  }
});

test("linha com valor zero é recusada apontando a linha", () => {
  const result = buildEntryRows(
    input({
      lines: [
        { creditor_id: A, kind: "entrada", amount: 100 },
        { creditor_id: B, kind: "saida", amount: 0 },
      ],
    }),
    CTX,
  );
  assert.deepEqual(result, { error: "Linha 2: valor não pode ser zero." });
});

test("arredonda para centavos antes de decidir se o valor é zero", () => {
  const result = buildEntryRows(input({ lines: [{ creditor_id: A, kind: "entrada", amount: 0.004 }] }), CTX);
  assert.deepEqual(result, { error: "Linha 1: valor não pode ser zero." });

  const ok = buildEntryRows(input({ lines: [{ creditor_id: A, kind: "saida", amount: 1234.567 }] }), CTX);
  assert.ok("rows" in ok);
  assert.equal(ok.rows[0].amount, -1234.57);
});

test("rendimento herda período e taxa do cabeçalho; as outras linhas não", () => {
  const result = buildEntryRows(
    input({
      period_start: "2026-08-01",
      period_end: "2026-08-31",
      rate: 0.0105,
      rate_basis: "periodo",
      lines: [
        { creditor_id: A, kind: "rendimento", amount: 350.5 },
        { creditor_id: B, kind: "rendimento", amount: -20 },
        { creditor_id: A, kind: "saida", amount: 1000 },
      ],
    }),
    CTX,
  );
  assert.ok("rows" in result, JSON.stringify(result));
  const [yieldA, yieldB, exitA] = result.rows;
  assert.equal(yieldA.amount, 350.5);
  assert.equal(yieldA.period_start, "2026-08-01");
  assert.equal(yieldA.period_end, "2026-08-31");
  assert.equal(yieldA.days, 30);
  assert.equal(yieldA.rate, 0.0105);
  assert.equal(yieldA.rate_basis, "periodo");
  // Rendimento negativo é ajuste e mantém o sinal digitado.
  assert.equal(yieldB.amount, -20);
  assert.equal(yieldB.period_start, "2026-08-01");
  assert.equal(yieldB.rate_basis, "periodo");
  assert.equal(exitA.amount, -1000);
  assert.equal(exitA.period_start, null);
  assert.equal(exitA.period_end, null);
  assert.equal(exitA.days, null);
  assert.equal(exitA.rate, null);
  assert.equal(exitA.rate_basis, null);
});

test("rendimento sem taxa é ajuste e sem período usa a data do lançamento", () => {
  const result = buildEntryRows(
    input({ rate_basis: "periodo", lines: [{ creditor_id: A, kind: "rendimento", amount: 12.34 }] }),
    CTX,
  );
  assert.ok("rows" in result);
  const [row] = result.rows;
  assert.equal(row.period_start, "2026-09-10");
  assert.equal(row.period_end, "2026-09-10");
  assert.equal(row.days, 0);
  assert.equal(row.rate, null);
  assert.equal(row.rate_basis, "ajuste");
});

test("período invertido é erro, mas só quando existe rendimento", () => {
  const bad = buildEntryRows(
    input({
      period_start: "2026-09-01",
      period_end: "2026-08-01",
      lines: [{ creditor_id: A, kind: "rendimento", amount: 10 }],
    }),
    CTX,
  );
  assert.deepEqual(bad, { error: "Início do período depois do fim." });

  const ignored = buildEntryRows(
    input({
      period_start: "2026-09-01",
      period_end: "2026-08-01",
      lines: [{ creditor_id: A, kind: "entrada", amount: 10 }],
    }),
    CTX,
  );
  assert.ok("rows" in ignored);
  assert.equal(ignored.rows[0].period_start, null);
});

test("descrição em branco vira null", () => {
  const result = buildEntryRows(input({ description: "   ", lines: [{ creditor_id: A, kind: "entrada", amount: 1 }] }), CTX);
  assert.ok("rows" in result);
  assert.equal(result.rows[0].description, null);
});

test("schema exige ao menos uma linha e limita o tamanho do lançamento", () => {
  const empty = newEntriesSchema.safeParse(input({ lines: [] }));
  assert.equal(empty.success, false);
  assert.equal(empty.success ? "" : empty.error.issues[0]?.message, "Informe ao menos uma linha.");

  const tooMany = newEntriesSchema.safeParse(
    input({
      lines: Array.from({ length: VB_MAX_ENTRY_LINES + 1 }, () => ({ creditor_id: A, kind: "entrada" as const, amount: 1 })),
    }),
  );
  assert.equal(tooMany.success, false);
  assert.equal(
    tooMany.success ? "" : tooMany.error.issues[0]?.message,
    `No máximo ${VB_MAX_ENTRY_LINES} linhas por lançamento.`,
  );
});

test("sumTypedLines soma por tipo a partir das strings digitadas e ignora inválidas", () => {
  const totals = sumTypedLines([
    { kind: "entrada", amount: "1.000,50" },
    { kind: "saida", amount: "-200" },
    { kind: "rendimento", amount: "-10,5" },
    { kind: "entrada", amount: "abc" },
    { kind: "saida", amount: "" },
  ]);
  assert.deepEqual(totals, { entradas: 1000.5, saidas: 200, rendimentos: -10.5, liquido: 790, bruto: 1211 });
});

// ─── Composição das linhas no formulário ─────────────────────────────────────

type Draft = { key: number; creditorId: string; kind: "entrada" | "saida" | "rendimento"; amount: string };

function keyed() {
  let next = 100;
  return (draft: { creditorId: string; kind: Draft["kind"]; amount: string }): Draft => ({ key: next++, ...draft });
}

const PEDRO = "c-pedro";
const MYLL = "c-mylliano";
const VITOR = "c-vitor";

test("replicatedFrom pega tipo e valor da última linha preenchida, ignorando as vazias", () => {
  assert.deepEqual(
    replicatedFrom([
      { creditorId: PEDRO, kind: "entrada", amount: "330.000" },
      { creditorId: MYLL, kind: "saida", amount: "  " },
    ]),
    { kind: "entrada", amount: "330.000" },
  );
  // Nada preenchido: herda o tipo da última linha e valor vazio.
  assert.deepEqual(replicatedFrom([{ creditorId: "", kind: "rendimento", amount: "" }]), {
    kind: "rendimento",
    amount: "",
  });
  assert.deepEqual(replicatedFrom([]), { kind: "entrada", amount: "" });
});

test("toggleCreditorLines: o primeiro nome ocupa a linha em branco, sem criar outra", () => {
  const rows = toggleCreditorLines([{ key: 1, creditorId: "", kind: "entrada", amount: "330.000" }], MYLL, keyed());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].creditorId, MYLL);
  assert.equal(rows[0].key, 1, "mantém a chave para não remontar o campo que está sendo digitado");
  assert.equal(rows[0].amount, "330.000");
});

test("toggleCreditorLines: o segundo nome entra replicando tipo e valor", () => {
  const rows = toggleCreditorLines([{ key: 1, creditorId: MYLL, kind: "entrada", amount: "330.000" }], VITOR, keyed());
  assert.deepEqual(
    rows.map((r) => [r.creditorId, r.kind, r.amount]),
    [
      [MYLL, "entrada", "330.000"],
      [VITOR, "entrada", "330.000"],
    ],
  );
});

test("toggleCreditorLines: clicar de novo tira o credor, e nunca deixa a lista vazia", () => {
  const two: Draft[] = [
    { key: 1, creditorId: MYLL, kind: "entrada", amount: "330.000" },
    { key: 2, creditorId: VITOR, kind: "entrada", amount: "330.000" },
  ];
  assert.deepEqual(toggleCreditorLines(two, VITOR, keyed()).map((r) => r.creditorId), [MYLL]);

  const single = toggleCreditorLines([two[0]], MYLL, keyed());
  assert.equal(single.length, 1);
  assert.equal(single[0].creditorId, "", "sobra uma linha em branco, com o valor preservado");
  assert.equal(single[0].amount, "330.000");
});

test("toggleCreditorLines respeita o teto de linhas", () => {
  const full: Draft[] = Array.from({ length: 3 }, (_, i) => ({
    key: i,
    creditorId: `c-${i}`,
    kind: "entrada" as const,
    amount: "1",
  }));
  assert.deepEqual(toggleCreditorLines(full, "c-novo", keyed(), 3).map((r) => r.creditorId), ["c-0", "c-1", "c-2"]);
});

test("addAllActiveLines replica o valor para todos e consome a linha em branco", () => {
  const rows = addAllActiveLines(
    [{ key: 1, creditorId: "", kind: "entrada", amount: "330.000" }],
    [PEDRO, MYLL, VITOR],
    keyed(),
  );
  assert.deepEqual(
    rows.map((r) => [r.creditorId, r.amount]),
    [
      [PEDRO, "330.000"],
      [MYLL, "330.000"],
      [VITOR, "330.000"],
    ],
  );
});

test("addAllActiveLines não duplica quem já está na lista", () => {
  const rows = addAllActiveLines(
    [{ key: 1, creditorId: MYLL, kind: "saida", amount: "500" }],
    [PEDRO, MYLL],
    keyed(),
  );
  assert.deepEqual(
    rows.map((r) => [r.creditorId, r.kind, r.amount]),
    [
      [MYLL, "saida", "500"],
      [PEDRO, "saida", "500"],
    ],
  );
});
