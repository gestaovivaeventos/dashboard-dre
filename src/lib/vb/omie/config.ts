// src/lib/vb/omie/config.ts
// Triagem da Omie: só a ABD Holding, só pagamentos, só a partir do dia em que
// o VB passou a ser o sistema (antes disso o extrato importado já cobre).
// Empresa fixada por id no código, como em @/lib/auth/restricted-companies.

import type { VbEntryKind } from "@/lib/vb/types";

export const VB_OMIE_COMPANY_ID = "85ce50b8-571a-49d2-b279-9a8d08cbe4ae"; // ABD Holding
export const VB_OMIE_COMPANY_NAME = "ABD Holding";
/** Inclusivo ('YYYY-MM-DD'). */
export const VB_OMIE_START_DATE = "2026-09-10";
/** Tipos de financial_entries que entram na triagem. Recebimentos: acrescentar "receita". */
export const VB_OMIE_TYPES: readonly string[] = ["despesa"];
/** Tipo sugerido pela categoria da Omie; fora do mapa é saída (é um pagamento). */
export const VB_OMIE_KIND_BY_CATEGORY: Readonly<Record<string, VbEntryKind>> = {
  "2.05.03": "saida", // Pagamento de Empréstimos (resgate)
  "2.05.01": "saida", // Juros sobre Empréstimos (juros pagos em dinheiro)
  "2.10.98": "entrada", // Pagamento de Dividendo (Anual) deixado no VB
};
/** Um sync 'running' mais velho que isso é lixo de execução interrompida, não trava o botão. */
export const VB_OMIE_SYNC_RUNNING_WINDOW_MS = 5 * 60 * 1000;
