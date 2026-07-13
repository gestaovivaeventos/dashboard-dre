"use client";

import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Download,
  FileSpreadsheet,
  FileText,
  Inbox,
  Loader2,
  Search,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toaster";
import { SegmentCompanyPicker } from "@/components/app/segment-company-picker";
import { fetchAllDrilldownRows, downloadDrilldownXlsx } from "@/lib/financeiro/drilldown-export";
import type {
  DashboardFilterState,
  DashboardRange,
  DashboardPeriodBucket,
  PeriodMode,
} from "@/lib/dashboard/dre";
import {
  saveSharedCompanyFilter,
  useSharedCompanyFilterHydration,
} from "@/lib/dashboard/shared-company-filter";
import type { Segment } from "@/lib/supabase/types";
import { ComparativoReport } from "@/components/app/comparativo-report";

interface CompanyOption {
  id: string;
  name: string;
}

interface ComparativoRow {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  level: number;
  type: "receita" | "despesa" | "calculado" | "misto";
  is_summary: boolean;
  sort_order: number;
  hasChildren: boolean;
  realizado: number;
  orcado: number;
  anoAnterior: number;
}

interface Props {
  filter: DashboardFilterState;
  range: DashboardRange;
  priorRange: DashboardRange;
  rows: ComparativoRow[];
  companies: CompanyOption[];
  selectedCompanyIds: string[];
  currentBucket: DashboardPeriodBucket;
  priorBucket: DashboardPeriodBucket;
  segments: Segment[];
  activeSegmentSlug: string | null;
}

interface DrilldownState {
  open: boolean;
  accountId: string;
  accountName: string;
  bucket: DashboardPeriodBucket;
}

interface DrilldownRow {
  id: string;
  payment_date: string;
  description: string;
  supplier_customer: string;
  document_number: string;
  value: number;
  company_name: string;
}

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "decimal",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}
// Variação percentual de `a` (base) para `b`.
function formatVar(a: number, b: number): string {
  if (a === 0) return "-";
  const pct = ((b - a) / Math.abs(a)) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}
// Para contas de RECEITA/resultado, realizado acima da base (orcado/ano
// anterior) e bom (verde). Para DESPESA a relacao e inversa: valor realizado
// maior que a base e ruim (vermelho). O sinal exibido nao muda; so a cor.
function varColor(a: number, b: number, isExpense = false): string {
  if (a === 0) return "text-muted-foreground/60";
  const pct = ((b - a) / Math.abs(a)) * 100;
  const favorable = isExpense ? pct <= 0 : pct >= 0;
  return favorable ? "text-emerald-700" : "text-red-700";
}

const MONTHS = [
  { value: 1, label: "Janeiro" }, { value: 2, label: "Fevereiro" }, { value: 3, label: "Marco" },
  { value: 4, label: "Abril" }, { value: 5, label: "Maio" }, { value: 6, label: "Junho" },
  { value: 7, label: "Julho" }, { value: 8, label: "Agosto" }, { value: 9, label: "Setembro" },
  { value: 10, label: "Outubro" }, { value: 11, label: "Novembro" }, { value: 12, label: "Dezembro" },
];

// Bandas de cor por coluna (para não confundir realizado/orçado/ano anterior).
const COL_REAL = "bg-emerald-500/[0.06]";
const COL_ORC = "bg-amber-500/[0.06]";
const COL_ANT = "bg-sky-500/[0.07]";

export function ComparativosAnuaisView({
  filter,
  range,
  priorRange,
  rows,
  companies,
  selectedCompanyIds,
  currentBucket,
  priorBucket,
  segments,
  activeSegmentSlug,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  useSharedCompanyFilterHydration();
  const { showToast } = useToast();

  const [periodMode, setPeriodMode] = useState<PeriodMode>(filter.periodMode);
  const [monthFrom, setMonthFrom] = useState(filter.monthFrom);
  const [yearFrom, setYearFrom] = useState(filter.yearFrom);
  const [monthTo, setMonthTo] = useState(filter.monthTo);
  const [yearTo, setYearTo] = useState(filter.yearTo);
  const [companySelection, setCompanySelection] = useState(filter.selectedCompanyIds);

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    rows.filter((r) => r.hasChildren).reduce((acc, r) => ({ ...acc, [r.id]: true }), {}),
  );
  const setAll = (open: boolean) =>
    setExpanded(rows.filter((r) => r.hasChildren).reduce((acc, r) => ({ ...acc, [r.id]: open }), {} as Record<string, boolean>));

  const byParent = useMemo(() => {
    const map = new Map<string | null, ComparativoRow[]>();
    rows.forEach((row) => {
      const siblings = map.get(row.parent_id) ?? [];
      siblings.push(row);
      map.set(row.parent_id, siblings);
    });
    map.forEach((siblings) =>
      siblings.sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code, undefined, { numeric: true })),
    );
    return map;
  }, [rows]);

  const visibleRows = useMemo(() => {
    const result: ComparativoRow[] = [];
    const walk = (parentId: string | null) => {
      (byParent.get(parentId) ?? []).forEach((child) => {
        result.push(child);
        if (expanded[child.id]) walk(child.id);
      });
    };
    walk(null);
    return result;
  }, [byParent, expanded]);

  // ── Drilldown ──────────────────────────────────────────────────────────────
  const [drilldown, setDrilldown] = useState<DrilldownState>({
    open: false, accountId: "", accountName: "", bucket: currentBucket,
  });
  const [drillRows, setDrillRows] = useState<DrilldownRow[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [exportingDrill, setExportingDrill] = useState(false);
  const [drillSearch, setDrillSearch] = useState("");
  const [drillPage, setDrillPage] = useState(1);
  const [drillPageSize, setDrillPageSize] = useState(20);
  const [drillTotal, setDrillTotal] = useState(0);
  const [drillTotalValue, setDrillTotalValue] = useState(0);

  const openDrilldown = async (
    account: ComparativoRow,
    bucket: DashboardPeriodBucket,
    page = 1,
    search = "",
  ) => {
    setDrilldown({ open: true, accountId: account.id, accountName: `${account.code} - ${account.name}`, bucket });
    setDrillLoading(true);
    const params = new URLSearchParams({
      accountId: account.id,
      dateFrom: bucket.dateFrom,
      dateTo: bucket.dateTo,
      companyIds: selectedCompanyIds.join(","),
      page: String(page),
      pageSize: String(drillPageSize),
      search,
    });
    const response = await fetch(`/api/dashboard/drilldown?${params.toString()}`, { cache: "no-store" });
    const payload = (await response.json()) as { rows?: DrilldownRow[]; total?: number; totalValue?: number };
    setDrillRows(payload.rows ?? []);
    setDrillTotal(payload.total ?? 0);
    setDrillTotalValue(payload.totalValue ?? 0);
    setDrillPage(page);
    setDrillLoading(false);
  };

  const handleExportDrilldown = async () => {
    setExportingDrill(true);
    try {
      const allRows = await fetchAllDrilldownRows("/api/dashboard/drilldown", {
        accountId: drilldown.accountId,
        dateFrom: drilldown.bucket.dateFrom,
        dateTo: drilldown.bucket.dateTo,
        companyIds: selectedCompanyIds.join(","),
        search: drillSearch,
      });
      if (allRows.length === 0) {
        showToast({ title: "Nada para exportar", description: "Nenhum lancamento neste drilldown.", variant: "destructive" });
        return;
      }
      downloadDrilldownXlsx(allRows, {
        origem: "Comparativos Anuais",
        accountName: drilldown.accountName,
        periodLabel: drilldown.bucket.label,
        multiCompany: selectedCompanyIds.length > 1,
      });
      showToast({ title: "Exportacao concluida", description: `${allRows.length} lancamento(s) exportado(s).`, variant: "success" });
    } catch (error) {
      showToast({ title: "Falha ao exportar", description: error instanceof Error ? error.message : "Erro.", variant: "destructive" });
    } finally {
      setExportingDrill(false);
    }
  };

  // ── Export da tabela (respeita linhas abertas/fechadas) ──────────────────────
  const [exportingTable, setExportingTable] = useState(false);
  const handleExportTable = async () => {
    if (visibleRows.length === 0) return;
    setExportingTable(true);
    try {
      // xlsx-js-style: mesmo API do SheetJS + estilos de célula (.s).
      const XLSX = await import("xlsx-js-style");
      type StyledCell = { v?: unknown; z?: string; s?: Record<string, unknown> };

      // Config por coluna: alinhamento, formato numérico e paleta batendo com a
      // tela (Realizado=verde, Orçado=âmbar, Ano Anterior=azul).
      interface ColCfg {
        align: "left" | "right" | "center";
        num?: boolean;
        pct?: boolean;
        hFill: string; hText: string; // header
        cFill?: string; cText?: string; // célula de dados
      }
      const NEUTRAL = { hFill: "FFE2E8F0", hText: "FF334155" };
      const cols: ColCfg[] = [
        { align: "left", ...NEUTRAL }, // Código
        { align: "left", ...NEUTRAL }, // Conta
        { align: "right", num: true, hFill: "FFA7F3D0", hText: "FF065F46", cFill: "FFF0FDF4", cText: "FF065F46" }, // Realizado
        { align: "right", num: true, hFill: "FFFDE68A", hText: "FF92400E", cFill: "FFFFFBEB", cText: "FF92400E" }, // Orçado
        { align: "center", pct: true, ...NEUTRAL }, // Prev x Real
        { align: "right", num: true, hFill: "FFBAE6FD", hText: "FF075985", cFill: "FFF0F9FF", cText: "FF075985" }, // Ano Anterior
        { align: "center", pct: true, ...NEUTRAL }, // Atual x Anter
      ];

      const header = ["Código", "Conta", "Realizado", "Orçado", "Prev. x Real.", "Ano Anterior", "Atual x Anter."];
      const aoa: (string | number)[][] = [header];
      for (const row of visibleRows) {
        const indent = "    ".repeat(Math.max(0, row.level - 1));
        aoa.push([
          row.code,
          indent + row.name,
          row.realizado,
          row.orcado,
          formatVar(row.orcado, row.realizado),
          row.anoAnterior,
          formatVar(row.anoAnterior, row.realizado),
        ]);
      }
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = [{ wch: 10 }, { wch: 46 }, { wch: 16 }, { wch: 16 }, { wch: 13 }, { wch: 16 }, { wch: 13 }];
      ws["!rows"] = [{ hpt: 22 }];

      const thin = { style: "thin", color: { rgb: "FFE2E8F0" } };
      const borders = { top: thin, bottom: thin, left: thin, right: thin };

      for (let r = 0; r < aoa.length; r++) {
        const meta = r === 0 ? null : visibleRows[r - 1];
        const isKey = meta ? ["4", "6", "8", "11"].includes(meta.code) : false;
        const isSummary = meta ? meta.is_summary : false;
        for (let c = 0; c < cols.length; c++) {
          const col = cols[c];
          const cell = ws[XLSX.utils.encode_cell({ r, c })] as StyledCell | undefined;
          if (!cell) continue;
          const s: Record<string, unknown> = {
            alignment: { horizontal: col.align, vertical: "center" },
            border: borders,
          };
          if (r === 0) {
            s.font = { bold: true, sz: 11, color: { rgb: col.hText } };
            s.fill = { patternType: "solid", fgColor: { rgb: col.hFill } };
          } else {
            const font: Record<string, unknown> = { bold: isKey || isSummary };
            if (col.cFill) {
              s.fill = { patternType: "solid", fgColor: { rgb: col.cFill } };
              font.color = { rgb: col.cText };
            } else if (isKey) {
              s.fill = { patternType: "solid", fgColor: { rgb: "FFE2E8F0" } };
            } else if (isSummary) {
              s.fill = { patternType: "solid", fgColor: { rgb: "FFF1F5F9" } };
            }
            if (col.num) cell.z = "#,##0.00";
            if (col.pct) {
              const v = String(cell.v ?? "");
              font.color = { rgb: v.startsWith("+") ? "FF047857" : v.startsWith("-") && v.length > 1 ? "FFB91C1C" : "FF94A3B8" };
            }
            s.font = font;
          }
          cell.s = s;
        }
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Comparativo");
      const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
      const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `comparativo-anual-${range.label.replace(/[^a-zA-Z0-9]+/g, "_")}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setExportingTable(false);
    }
  };

  // ── Export PDF (identidade do BI, 1 página, respeita linhas abertas/fechadas) ─
  const reportRef = useRef<HTMLDivElement>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const companyLabel = useMemo(() => {
    if (selectedCompanyIds.length === 1) {
      return companies.find((c) => c.id === selectedCompanyIds[0])?.name ?? "Consolidado";
    }
    const seg = segments.find((s) => s.slug === activeSegmentSlug);
    return `${seg?.name ?? "Consolidado"} — ${selectedCompanyIds.length} empresas`;
  }, [selectedCompanyIds, companies, segments, activeSegmentSlug]);

  const handleExportPdf = async () => {
    if (!reportRef.current || visibleRows.length === 0) return;
    setExportingPdf(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);
      const canvas = await html2canvas(reportRef.current, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      const aspect = canvas.height / canvas.width;
      let w: number;
      let h: number;
      if (pw * aspect <= ph) {
        w = pw;
        h = pw * aspect;
      } else {
        h = ph;
        w = ph / aspect;
      }
      pdf.addImage(imgData, "PNG", (pw - w) / 2, (ph - h) / 2, w, h);
      pdf.save(`comparativo-anual-${range.label.replace(/[^a-zA-Z0-9]+/g, "_")}.pdf`);
      showToast({ title: "PDF gerado", description: "Relatório em uma página.", variant: "success" });
    } catch (e) {
      showToast({
        title: "Falha ao gerar PDF",
        description: e instanceof Error ? e.message : "Erro ao gerar o PDF.",
        variant: "destructive",
      });
    } finally {
      setExportingPdf(false);
    }
  };

  // ── Filtros → URL ────────────────────────────────────────────────────────────
  const buildQuery = () => {
    const params = new URLSearchParams();
    params.set("periodMode", periodMode);
    if (periodMode === "especifico") {
      params.set("monthFrom", String(monthFrom));
      params.set("yearFrom", String(yearFrom));
      params.set("monthTo", String(monthTo));
      params.set("yearTo", String(yearTo));
    }
    if (companySelection.length !== companies.length) params.set("companyIds", companySelection.join(","));
    return params.toString();
  };
  const handleApply = () => {
    saveSharedCompanyFilter(companySelection);
    router.push(`${pathname}?${buildQuery()}`);
  };

  const gridTemplate = "minmax(320px, 2.6fr) repeat(5, minmax(120px, 1fr))";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border bg-background p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold">Comparativos Anuais</h2>
            <p className="text-sm text-muted-foreground">
              Realizado x Orçado x Ano Anterior | {range.label} <span className="text-muted-foreground/70">(anterior: {priorRange.label})</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => void handleExportPdf()} disabled={exportingPdf || visibleRows.length === 0}>
              {exportingPdf ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
              Exportar PDF
            </Button>
            <Button type="button" variant="outline" onClick={() => void handleExportTable()} disabled={exportingTable || visibleRows.length === 0}>
              {exportingTable ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Exportar XLSX
            </Button>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="space-y-4 rounded-xl border bg-background p-4">
        <div className="flex flex-wrap items-start gap-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Segmento e empresas</label>
            <SegmentCompanyPicker
              segments={segments}
              activeSegmentSlug={activeSegmentSlug}
              companies={companies}
              selected={companySelection}
              onChange={(ids) => {
                setCompanySelection(ids);
                saveSharedCompanyFilter(ids);
              }}
              disabled={companies.length <= 1}
            />
            <div className="flex gap-1 pt-1">
              <Button type="button" variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setAll(true)} title="Expandir todas">
                <ChevronsUpDown className="h-4 w-4" />
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setAll(false)} title="Recolher todas">
                <ChevronsDownUp className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Periodo</label>
            <div className="flex gap-1">
              {([
                { value: "mes_atual", label: "Mes atual" },
                { value: "especifico", label: "Periodo especifico" },
              ] as const).map((opt) => (
                <Button
                  key={opt.value}
                  type="button"
                  size="sm"
                  variant={periodMode === opt.value ? "default" : "outline"}
                  onClick={() => setPeriodMode(opt.value)}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>

          {periodMode === "especifico" && (
            <>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">De</label>
                <div className="flex gap-1">
                  <select value={monthFrom} onChange={(e) => setMonthFrom(Number(e.target.value))} className="h-10 rounded-md border border-input bg-background px-2 text-sm">
                    {MONTHS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                  <Input className="w-20" type="number" value={yearFrom} onChange={(e) => setYearFrom(Number(e.target.value))} />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Ate</label>
                <div className="flex gap-1">
                  <select value={monthTo} onChange={(e) => setMonthTo(Number(e.target.value))} className="h-10 rounded-md border border-input bg-background px-2 text-sm">
                    {MONTHS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                  <Input className="w-20" type="number" value={yearTo} onChange={(e) => setYearTo(Number(e.target.value))} />
                </div>
              </div>
            </>
          )}

          <div className="space-y-1">
            <span aria-hidden className="block text-xs font-medium opacity-0">.</span>
            <Button type="button" onClick={handleApply}>Aplicar</Button>
          </div>
        </div>
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto rounded-xl border bg-muted/50">
        <div style={{ minWidth: "920px" }}>
          {/* Header */}
          <div className="grid border-b bg-muted px-4 py-3 text-xs font-semibold uppercase text-muted-foreground" style={{ gridTemplateColumns: gridTemplate }}>
            <span className="sticky left-0 z-10 bg-muted">Contas</span>
            <span className={`rounded-t px-2 text-right text-emerald-700 ${COL_REAL}`}>Realizado</span>
            <span className={`rounded-t px-2 text-right text-amber-700 ${COL_ORC}`}>Orçado</span>
            <span className="px-2 text-center">Prev. x Real.</span>
            <span className={`rounded-t px-2 text-right text-sky-700 ${COL_ANT}`}>Ano Anterior</span>
            <span className="px-2 text-center">Atual x Anter.</span>
          </div>

          {rows.length === 0 ? (
            <div className="flex min-h-44 flex-col items-center justify-center gap-2 text-muted-foreground">
              <Inbox className="h-6 w-6" />
              <p className="text-sm">Nenhum dado encontrado para os filtros selecionados.</p>
            </div>
          ) : null}

          {visibleRows.map((row) => {
            const isKeyResult = ["4", "6", "8", "11"].includes(row.code);
            const rowClass = isKeyResult ? "bg-background font-bold uppercase" : row.is_summary ? "bg-muted font-semibold" : "bg-background";
            const borderClass = isKeyResult ? "border-t-2 border-slate-500" : "border-t border-slate-200";
            const canDrill = !row.is_summary;

            return (
              <div key={row.id} className={`grid px-4 py-2 text-sm ${rowClass} ${borderClass}`} style={{ gridTemplateColumns: gridTemplate }}>
                <div className="sticky left-0 z-[1] flex items-center gap-2 bg-inherit" style={{ paddingLeft: `${(row.level - 1) * 14}px` }}>
                  {row.hasChildren ? (
                    <button type="button" onClick={() => setExpanded((prev) => ({ ...prev, [row.id]: !prev[row.id] }))} className="rounded p-0.5 text-muted-foreground hover:bg-muted">
                      {expanded[row.id] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  ) : (
                    <span className="w-4" />
                  )}
                  <span className="truncate" title={`${row.code} - ${row.name}`}>{row.name}</span>
                </div>

                {/* Realizado */}
                <div className={`px-2 text-right font-semibold text-emerald-800 ${COL_REAL}`}>
                  {canDrill ? (
                    <button type="button" className="w-full text-right hover:underline" onClick={() => void openDrilldown(row, currentBucket, 1, "")}>
                      {formatCurrency(row.realizado)}
                    </button>
                  ) : (
                    formatCurrency(row.realizado)
                  )}
                </div>

                {/* Orçado */}
                <div className={`px-2 text-right text-amber-800 ${COL_ORC}`}>{formatCurrency(row.orcado)}</div>

                {/* Prev x Real */}
                <div className={`px-2 text-center ${varColor(row.orcado, row.realizado, row.type === "despesa")}`}>{formatVar(row.orcado, row.realizado)}</div>

                {/* Ano Anterior */}
                <div className={`px-2 text-right text-sky-800 ${COL_ANT}`}>
                  {canDrill ? (
                    <button type="button" className="w-full text-right hover:underline" onClick={() => void openDrilldown(row, priorBucket, 1, "")}>
                      {formatCurrency(row.anoAnterior)}
                    </button>
                  ) : (
                    formatCurrency(row.anoAnterior)
                  )}
                </div>

                {/* Atual x Anter */}
                <div className={`px-2 text-center ${varColor(row.anoAnterior, row.realizado, row.type === "despesa")}`}>{formatVar(row.anoAnterior, row.realizado)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Drilldown Sheet */}
      <Sheet open={drilldown.open} onOpenChange={(open) => setDrilldown((p) => ({ ...p, open }))}>
        <SheetContent className="left-auto right-0 max-w-5xl border-l border-r-0 p-5">
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-lg font-semibold">Drilldown</h3>
                <Button type="button" variant="outline" size="sm" onClick={() => setDrilldown((p) => ({ ...p, open: false }))}>
                  <ArrowLeft className="mr-2 h-4 w-4" />Voltar
                </Button>
              </div>
              <div className="mb-2 text-xs text-muted-foreground">
                Comparativos Anuais &gt; {drilldown.accountName} &gt; {drilldown.bucket.label}
              </div>
              <p className="text-sm text-muted-foreground">{drilldown.accountName} | {drilldown.bucket.label}</p>
            </div>

            <div className="flex items-center gap-2">
              <Input placeholder="Buscar descricao, fornecedor ou documento" value={drillSearch} onChange={(e) => setDrillSearch(e.target.value)} />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const account = rows.find((r) => r.id === drilldown.accountId);
                  if (account) void openDrilldown(account, drilldown.bucket, 1, drillSearch);
                }}
              >
                <Search className="mr-2 h-4 w-4" />Buscar
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleExportDrilldown()}
                disabled={exportingDrill || drillLoading || drillRows.length === 0}
                title="Exportar todos os lancamentos deste drilldown para Excel"
              >
                {exportingDrill ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
                Exportar Excel
              </Button>
            </div>

            <div className="overflow-hidden rounded-md border">
              <div className="grid grid-cols-[100px_2fr_1.5fr_140px_1fr] gap-2 bg-muted px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
                <span>Data Pgto</span><span>Descricao</span><span>Fornecedor/Cliente</span><span className="text-right">Valor</span><span>Unidade</span>
              </div>
              <div className="max-h-[420px] overflow-y-auto">
                {drillLoading ? (
                  <div className="flex items-center justify-center py-10 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Carregando lancamentos...</div>
                ) : drillRows.length === 0 ? (
                  <p className="px-3 py-8 text-center text-sm text-muted-foreground">Nenhum lancamento encontrado.</p>
                ) : (
                  drillRows.map((row) => (
                    <div key={row.id} className="grid grid-cols-[100px_2fr_1.5fr_140px_1fr] gap-2 border-t px-3 py-2 text-sm">
                      <span>{new Date(row.payment_date).toLocaleDateString("pt-BR")}</span>
                      <span className="truncate" title={row.description}>{row.description}</span>
                      <span className="truncate" title={row.supplier_customer || "-"}>{row.supplier_customer || "-"}</span>
                      <span className="text-right">{formatCurrency(row.value)}</span>
                      <span>{row.company_name}</span>
                    </div>
                  ))
                )}
              </div>
              <div className="flex items-center justify-between border-t bg-muted px-3 py-2 text-sm">
                <div>Registros: {drillTotal} | Total da pagina: <strong>{formatCurrency(drillTotalValue)}</strong></div>
                <div className="flex items-center gap-2">
                  <select value={String(drillPageSize)} onChange={(e) => setDrillPageSize(Number(e.target.value))} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                    <option value="20">20</option><option value="50">50</option><option value="100">100</option>
                  </select>
                  <Button type="button" size="sm" variant="outline" disabled={drillPage <= 1} onClick={() => {
                    const account = rows.find((r) => r.id === drilldown.accountId);
                    if (account) void openDrilldown(account, drilldown.bucket, drillPage - 1, drillSearch);
                  }}><ChevronsLeft className="h-4 w-4" /></Button>
                  <span>Pagina {drillPage}</span>
                  <Button type="button" size="sm" variant="outline" disabled={drillPage * drillPageSize >= drillTotal} onClick={() => {
                    const account = rows.find((r) => r.id === drilldown.accountId);
                    if (account) void openDrilldown(account, drilldown.bucket, drillPage + 1, drillSearch);
                  }}><ChevronsRight className="h-4 w-4" /></Button>
                </div>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Relatório oculto (fora da tela) capturado no PDF — sempre em sync com
          as linhas abertas/fechadas via visibleRows. */}
      <div ref={reportRef} style={{ position: "absolute", left: "-99999px", top: 0 }} aria-hidden>
        <ComparativoReport
          companyLabel={companyLabel}
          periodLabel={range.label}
          priorPeriodLabel={priorRange.label}
          rows={visibleRows}
        />
      </div>
    </div>
  );
}
