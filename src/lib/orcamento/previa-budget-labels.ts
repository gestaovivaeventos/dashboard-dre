// Rótulos das linhas do orçamento geradas pela prévia de Despesas com pessoal.
//
// Eles entram em budget_uploads_raw com source='pessoal' e aparecem na tela
// Mapeamento → Linhas do Orçamento, onde cada um é ligado a uma conta da DRE —
// exatamente como as linhas de uma planilha importada. É por isso que o prefixo
// existe: o rótulo tem de ser inconfundível na lista de mapeamento e não pode
// colidir com uma linha vinda de planilha.
//
// O rótulo é DERIVADO do label da linha da prévia, e não uma tabela fixa,
// porque as linhas são dinâmicas: além das 6 fixas, cada benefício separado
// vira uma linha própria ("Pessoal — Vale transporte").
//
// Módulo "puro" (sem "use server"): importável por client e server.

export const PREVIA_BUDGET_SOURCE = "pessoal";

export const PREVIA_BUDGET_PREFIXO = "Pessoal — ";

/** Rótulo de orçamento de uma linha da prévia. */
export function rotuloOrcamento(labelDaLinha: string): string {
  return `${PREVIA_BUDGET_PREFIXO}${labelDaLinha}`;
}
