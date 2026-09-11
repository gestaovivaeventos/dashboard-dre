// src/components/vb/omie-pending-table.test.tsx
import assert from "node:assert/strict";
import { test } from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OmiePendingTable } from "@/components/vb/omie-pending-table";
import type { VbOmieMovement } from "@/lib/vb/types";

function movement(
  omie_id: string,
  payment_date: string,
  supplier_customer: string,
  description: string,
  value: number,
  category_name: string,
): VbOmieMovement {
  return {
    id: `fe-${omie_id}`,
    omie_id,
    payment_date,
    supplier_customer,
    description,
    category_code: "2.05.03",
    category_name,
    value,
    document_number: null,
  };
}

const ROWS = [
  movement("m-new", "2026-09-12", "FERNANDO SOTRATE FERREIRA", "RESGATE VB", 330000, "Pagamento de Empréstimos"),
  movement("m-old", "2026-09-10", "VILLAGE EMPREENDIMENTOS", "APORTE EMPRESA", 30000, "Aumento de capital em controlada"),
];

test("mantém a ordem recebida (mais recente primeiro) e mostra categoria, sugestão e ações", () => {
  const html = renderToStaticMarkup(
    <OmiePendingTable
      rows={ROWS}
      suggestions={{ "m-new": { creditorName: "Sotrate", kind: "saida" }, "m-old": null }}
      onLink={() => {}}
      onDiscard={() => {}}
      emptyText="vazio"
    />,
  );
  assert.ok(html.indexOf("RESGATE VB") < html.indexOf("APORTE EMPRESA"));
  assert.ok(html.includes("Pagamento de Empréstimos"));
  assert.ok(html.includes("Sotrate"));
  assert.ok(html.includes("Saída"));
  assert.ok(html.includes("Vincular"));
  assert.ok(html.includes("Descartar"));
  assert.ok(!/planilha/i.test(html));
});

test("lista vazia mostra o texto de vazio", () => {
  const html = renderToStaticMarkup(
    <OmiePendingTable rows={[]} suggestions={{}} onLink={() => {}} onDiscard={() => {}} emptyText="Nenhum pagamento aguardando." />,
  );
  assert.ok(html.includes("Nenhum pagamento aguardando."));
});
