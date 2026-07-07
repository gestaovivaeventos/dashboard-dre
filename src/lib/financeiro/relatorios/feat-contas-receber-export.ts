import * as XLSX from "xlsx";

import type { FeatContaReceberDetalhe } from "@/lib/financeiro/relatorios/feat-contas-receber-aberto";

// ============================================================================
// Exportação do DETALHAMENTO de "Contas a receber em aberto — Feat Produções"
// para Excel (.xlsx). Mesma mecânica do drilldown-export.ts: o arquivo é gerado
// e baixado no CLIENTE via SheetJS — os dados já vêm no payload do relatório
// (campo `detalhes`), sem rota nova nem chamada extra à Omie.
// ============================================================================

function sanitizeFilenamePart(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

export interface FeatContasReceberExportMeta {
  /** Rótulo do período de referência (ex.: "Jul/26"). Vai no nome do arquivo. */
  referenciaLabel: string;
}

// Monta a planilha (cabeçalho + uma linha por título + TOTAL) e dispara o
// download do .xlsx. As datas já vêm no formato dd/mm/aaaa da Omie.
export function downloadFeatContasReceberXlsx(
  detalhes: FeatContaReceberDetalhe[],
  meta: FeatContasReceberExportMeta,
): void {
  const header = [
    "Cliente (nome fantasia)",
    "Data de vencimento",
    "Data de previsão",
    "Status",
    "Dias em atraso",
    "Valor em aberto (R$)",
    "Projeto",
    "Categoria",
  ];
  const valueColIdx = 5; // "Valor em aberto (R$)"
  const diasColIdx = 4; // "Dias em atraso"

  const aoa: (string | number | null)[][] = [header];
  let total = 0;
  for (const d of detalhes) {
    const v = Number(d.valorEmAberto ?? 0);
    total += Number.isFinite(v) ? v : 0;
    aoa.push([
      d.cliente,
      d.dataVencimento ?? "",
      d.dataPrevisao ?? "",
      d.status,
      d.status === "Em atraso" ? d.diasAtraso : "",
      Number.isFinite(v) ? v : 0,
      d.projeto,
      d.categoria,
    ]);
  }
  const totalLine: (string | number | null)[] = new Array(header.length).fill("");
  totalLine[0] = "TOTAL";
  totalLine[valueColIdx] = total;
  aoa.push(totalLine);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 36 }, // Cliente (nome fantasia)
    { wch: 16 }, // Data de vencimento
    { wch: 16 }, // Data de previsão
    { wch: 12 }, // Status
    { wch: 14 }, // Dias em atraso
    { wch: 18 }, // Valor em aberto (R$)
    { wch: 34 }, // Projeto
    { wch: 30 }, // Categoria
  ];
  // Formato numérico na coluna de valor (milhar + 2 casas) e inteiro nos dias.
  for (let r = 1; r < aoa.length; r++) {
    const valAddr = XLSX.utils.encode_cell({ r, c: valueColIdx });
    const valCell = ws[valAddr];
    if (valCell && typeof valCell.v === "number") valCell.z = "#,##0.00";
    const diasAddr = XLSX.utils.encode_cell({ r, c: diasColIdx });
    const diasCell = ws[diasAddr];
    if (diasCell && typeof diasCell.v === "number") diasCell.z = "0";
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Contas a receber");

  const filename = `contas_receber_aberto_feat_${sanitizeFilenamePart(
    meta.referenciaLabel,
  )}.xlsx`;

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
