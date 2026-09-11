// src/lib/vb/omie/suggest.ts
// Sugestões da triagem da Omie. Tudo puro: nada aqui decide, só propõe — a
// decisão é sempre do gestor no diálogo.

import { numberToInput } from "@/lib/orcamento/format";
import {
  VB_OMIE_COMPANY_ID,
  VB_OMIE_KIND_BY_CATEGORY,
  VB_OMIE_START_DATE,
  VB_OMIE_TYPES,
} from "@/lib/vb/omie/config";
import type { VbCreditorOption, VbEntryKind, VbEntryPrefill, VbOmieMovement } from "@/lib/vb/types";

/** Mesmo limite da coluna/descrição do lançamento manual. */
export const VB_OMIE_DESCRIPTION_MAX = 300;

/** NFD + remove marcas diacríticas (faixa U+0300–U+036F) + minúsculas. Não tokeniza. */
export function normalizeText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** "MARIA APARECIDA - CONTA BRADESCO" → ["maria","aparecida","conta","bradesco"]. */
export function normalizeTokens(value: string | null | undefined): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/**
 * Cada token do nome do credor precisa ser prefixo de um token DISTINTO do
 * fornecedor, na ordem: "Pedro P" casa "PEDRO PAULO", não "PEDRO HENRIQUE"
 * (o "P" não pode reaproveitar PEDRO).
 */
export function matchesSupplier(creditorName: string, supplier: string | null): boolean {
  const wanted = normalizeTokens(creditorName);
  const have = normalizeTokens(supplier);
  if (wanted.length === 0 || have.length === 0) return false;
  let position = 0;
  for (const token of wanted) {
    let found = -1;
    for (let i = position; i < have.length; i++) {
      if (have[i].startsWith(token)) {
        found = i;
        break;
      }
    }
    if (found === -1) return false;
    position = found + 1;
  }
  return true;
}

/** Memória (fornecedor → credor do último vínculo) antes do nome; ambíguo → null. */
export function suggestCreditor(
  supplier: string | null,
  creditors: readonly VbCreditorOption[],
  memory: Readonly<Record<string, string>>,
): string | null {
  if (!supplier) return null;
  const remembered = memory[supplier];
  if (remembered && creditors.some((c) => c.id === remembered)) return remembered;
  const matches = creditors.filter((c) => c.active && matchesSupplier(c.name, supplier));
  return matches.length === 1 ? matches[0].id : null;
}

export function suggestKind(categoryCode: string | null): VbEntryKind {
  return (categoryCode && VB_OMIE_KIND_BY_CATEGORY[categoryCode]) || "saida";
}

/** Entra na triagem? Empresa fixa, tipo permitido e data no recorte (inclusivo). */
export function isCandidateMovement(row: { company_id: string; type: string; payment_date: string }): boolean {
  return (
    row.company_id === VB_OMIE_COMPANY_ID &&
    VB_OMIE_TYPES.includes(row.type) &&
    row.payment_date >= VB_OMIE_START_DATE
  );
}

/** Valores iniciais do diálogo: uma linha com o valor do pagamento. */
export function prefillFromMovement(
  movement: VbOmieMovement,
  creditors: readonly VbCreditorOption[],
  memory: Readonly<Record<string, string>>,
): VbEntryPrefill {
  const creditorId =
    suggestCreditor(movement.supplier_customer, creditors, memory) ??
    creditors.find((c) => c.active)?.id ??
    creditors[0]?.id ??
    "";
  return {
    date: movement.payment_date,
    description: (movement.description ?? "").trim().slice(0, VB_OMIE_DESCRIPTION_MAX),
    lines: [{ creditorId, kind: suggestKind(movement.category_code), amount: numberToInput(movement.value) }],
  };
}
