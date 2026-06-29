import * as XLSX from "xlsx";

// ============================================================================
// Exportação do DRILLDOWN do módulo financeiro para Excel (.xlsx).
//
// Compartilhado pelos drilldowns que têm o MESMO shape de linha e a MESMA
// paginação (page/pageSize/total): DRE (Dashboard), Budget e Forecast
// (Previsto × Realizado e Projeção) e Fluxo de Caixa.
//
// O painel de drilldown é PAGINADO; para exportar TUDO, `fetchAllDrilldownRows`
// percorre as páginas (100/req) até cobrir o `total`. O arquivo é gerado e
// baixado no CLIENTE via SheetJS — nenhuma rota nova, nenhum dado novo.
// ============================================================================

export interface DrilldownExportRow {
  payment_date?: string;
  description?: string;
  supplier_customer?: string;
  document_number?: string;
  value?: number | string | null;
  company_name?: string;
}

interface DrilldownPagePayload {
  rows?: DrilldownExportRow[];
  total?: number;
  error?: string;
}

// Percorre as páginas do drilldown (mesma rota/params do painel, só variando
// page) e devolve TODAS as linhas. pageSize 100 (cap das rotas) — a maioria dos
// drilldowns cabe em 1 requisição; grandes percorrem em blocos. Cap de
// segurança em 500 páginas (50k linhas).
export async function fetchAllDrilldownRows(
  endpoint: string,
  baseParams: Record<string, string>,
): Promise<DrilldownExportRow[]> {
  const all: DrilldownExportRow[] = [];
  let total = Infinity;
  for (let page = 1; page <= 500; page++) {
    const params = new URLSearchParams({
      ...baseParams,
      page: String(page),
      pageSize: "100",
    });
    const res = await fetch(`${endpoint}?${params.toString()}`, { cache: "no-store" });
    const payload = (await res.json().catch(() => null)) as DrilldownPagePayload | null;
    if (!res.ok || !payload || payload.error) {
      throw new Error(payload?.error ?? `Falha ao exportar (HTTP ${res.status}).`);
    }
    const rows = payload.rows ?? [];
    all.push(...rows);
    total = typeof payload.total === "number" ? payload.total : all.length;
    if (rows.length === 0 || all.length >= total) break;
  }
  return all;
}

// "2026-05-01" → "01/05/2026" (sem `new Date` p/ não escorregar de fuso).
function formatDateBR(value: string | undefined): string {
  if (!value) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

function sanitizeFilenamePart(value: string): string {
  // Troca tudo que não é alfanumérico ASCII por "_" (acentos viram "_" também).
  return value
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

export interface DrilldownExportMeta {
  /** Origem (ex.: "DRE", "Budget e Forecast", "Fluxo de Caixa") — vai no nome. */
  origem: string;
  /** Rótulo da conta (ex.: "1.1 - Clientes - Locação"). */
  accountName: string;
  /** Rótulo do período (ex.: "Mai/26" ou "Total"). */
  periodLabel: string;
  /** Mostra a coluna "Empresa" (consolidado multi-empresa). */
  multiCompany: boolean;
  /** Rótulo da coluna de data (default "Data"). Fluxo competência usa "Data Reg.". */
  dateLabel?: string;
}

// Monta a planilha (cabeçalho + linhas + TOTAL) e dispara o download do .xlsx.
export function downloadDrilldownXlsx(
  rows: DrilldownExportRow[],
  meta: DrilldownExportMeta,
): void {
  const showCompany = meta.multiCompany;
  const header = [
    meta.dateLabel ?? "Data",
    "Descrição",
    "Fornecedor / Cliente",
    "Documento",
    ...(showCompany ? ["Empresa"] : []),
    "Valor (R$)",
  ];
  const valueColIdx = header.length - 1;

  const aoa: (string | number | null)[][] = [header];
  let total = 0;
  for (const r of rows) {
    const v = Number(r.value ?? 0);
    total += Number.isFinite(v) ? v : 0;
    aoa.push([
      formatDateBR(r.payment_date),
      r.description ?? "",
      r.supplier_customer ?? "",
      r.document_number ?? "",
      ...(showCompany ? [r.company_name ?? ""] : []),
      Number.isFinite(v) ? v : 0,
    ]);
  }
  const totalLine: (string | number | null)[] = new Array(header.length).fill("");
  totalLine[0] = "TOTAL";
  totalLine[valueColIdx] = total;
  aoa.push(totalLine);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 12 },
    { wch: 50 },
    { wch: 32 },
    { wch: 16 },
    ...(showCompany ? [{ wch: 24 }] : []),
    { wch: 16 },
  ];
  // Formato numérico (milhar + 2 casas) na coluna de valor, linhas de dados + total.
  for (let r = 1; r < aoa.length; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: valueColIdx });
    const cell = ws[addr];
    if (cell && typeof cell.v === "number") cell.z = "#,##0.00";
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Drilldown");

  const filename = `drilldown_${sanitizeFilenamePart(meta.origem)}_${sanitizeFilenamePart(
    meta.accountName,
  )}_${sanitizeFilenamePart(meta.periodLabel)}.xlsx`;

  // Download client-side robusto (Blob + <a>) — evita depender do detector de
  // ambiente do XLSX.writeFile no bundle do browser.
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
