import type { PreviaDreLinha } from "@/lib/orcamento/actions/previa-orcamento";

// ============================================================================
// Exportação da PRÉVIA DO ORÇAMENTO para Excel (.xlsx). Mesma mecânica do
// feat-contas-receber-export.ts / drilldown-export.ts: o arquivo é gerado e
// baixado no CLIENTE via SheetJS — as linhas já vêm no payload da prévia, sem
// rota nova nem chamada extra ao banco. A planilha espelha a tabela da tela:
// uma coluna por mês + a coluna "Ano" (total), na mesma ordem das linhas.
// ============================================================================

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

/** Caracteres que o Excel recusa em nome de aba. */
const ABA_PROIBIDO = new Set(["\\", "/", "?", "*", "[", "]", ":"]);

export interface PreviaOrcamentoExportMeta {
  /** Nome da empresa (vai no nome do arquivo). */
  empresaLabel: string;
  /** Ano do orçamento. */
  ano: number;
  /**
   * Setor recortado, quando a prévia não é a da empresa inteira. Vai para o
   * nome do arquivo e para a aba: dois downloads da mesma empresa em setores
   * diferentes não podem virar o mesmo arquivo na pasta de downloads.
   */
  setorLabel?: string | null;
}

function sanitizeFilenamePart(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

// Monta a planilha (cabeçalho Linha + 12 meses + Ano, uma linha por conta da
// DRE) e dispara o download do .xlsx. Recebe exatamente as linhas visíveis na
// tela, para o Excel bater com o que o usuário está vendo.
export async function downloadPreviaOrcamentoXlsx(
  linhas: PreviaDreLinha[],
  meta: PreviaOrcamentoExportMeta,
): Promise<void> {
  // O xlsx (~430 KB minificado) só é necessário no momento do download. Import
  // dinâmico aqui em vez de estático no topo: senão a rota inteira carrega a
  // lib no bundle inicial mesmo sem ninguém exportar nada.
  const XLSX = await import("xlsx");

  const header = ["Código", "Linha", ...MESES, "Ano"];
  const primeiroMesIdx = 2; // 1ª coluna de mês (após Código e Linha)

  const aoa: (string | number | null)[][] = [header];
  for (const l of linhas) {
    // Indenta o nome pela hierarquia, como na tela, para preservar a leitura.
    const indent = "  ".repeat(Math.max(0, l.level - 1));
    aoa.push([
      l.code,
      `${indent}${l.name}`,
      ...l.meses.map((v) => (Number.isFinite(v) ? v : 0)),
      Number.isFinite(l.totalAno) ? l.totalAno : 0,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 8 }, // Código
    { wch: 42 }, // Linha
    ...MESES.map(() => ({ wch: 13 })), // 12 meses
    { wch: 15 }, // Ano
  ];
  // Formato monetário (milhar + 2 casas) em todas as colunas de valor.
  const ultimaColValor = header.length - 1; // coluna "Ano"
  for (let r = 1; r < aoa.length; r++) {
    for (let c = primeiroMesIdx; c <= ultimaColValor; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (cell && typeof cell.v === "number") cell.z = "#,##0.00";
    }
  }
  // Congela o cabeçalho e as duas primeiras colunas ao abrir no Excel — mesma
  // ideia do sticky da tela.
  ws["!freeze"] = { xSplit: 2, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  // Nome da aba: o Excel corta em 31 caracteres e recusa alguns símbolos, então
  // o setor entra sanitizado e o conjunto é truncado.
  const aba = meta.setorLabel
    ? Array.from(`Prévia ${meta.setorLabel}`)
        .map((ch) => (ABA_PROIBIDO.has(ch) ? " " : ch))
        .join("")
        .slice(0, 31)
    : "Prévia do orçamento";
  XLSX.utils.book_append_sheet(wb, ws, aba);

  const sufixoSetor = meta.setorLabel ? `_${sanitizeFilenamePart(meta.setorLabel)}` : "";
  const filename = `previa_orcamento_${sanitizeFilenamePart(meta.empresaLabel)}${sufixoSetor}_${meta.ano}.xlsx`;

  // Download client-side robusto (Blob + <a>) — mesmo padrão do drilldown.
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const blob = new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
