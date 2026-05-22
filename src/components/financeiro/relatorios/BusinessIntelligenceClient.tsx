"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Download,
  FlaskConical,
  Loader2,
  Sparkles,
} from "lucide-react";

import { OnePageReportPreview } from "@/components/financeiro/relatorios/OnePageReportPreview";
import type { OnePageReportPreviewData } from "@/components/financeiro/relatorios/OnePageReportPreview";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/toaster";
import {
  mapOnePageApiResponseToPreviewData,
  type OnePageApiResponse,
} from "@/lib/financeiro/relatorios/one-page-report-mapper";

// ============================================================================
// BusinessIntelligenceClient — controla os filtros (empresa, periodo) e o
// estado da chamada manual a /api/intelligence/one-page.
//
// Regras:
//   - NAO chama a rota automaticamente. Apenas quando o usuario clica em
//     "Gerar relatório".
//   - Estado inicial: data = undefined → componente de preview cai no mock
//     interno. Texto explicativo informa o usuario.
//   - Em caso de erro: mantem o ultimo `data` (mock ou ultimo sucesso) e
//     mostra alerta no topo. NAO mistura mock com numeros parciais reais.
//   - Botao "Gerar relatório" so habilita com (companyId, dateFrom, dateTo).
//   - Datas: native <input type="date">. Sem libraries extras.
// ============================================================================

interface CompanyOption {
  id: string;
  name: string;
}

interface BusinessIntelligenceClientProps {
  companies: CompanyOption[];
  /**
   * Indica se o usuario tem permissao de admin (a rota exige admin).
   * Se false, o botao "Gerar relatorio" fica desabilitado com aviso.
   */
  canGenerate: boolean;
  /**
   * True apenas quando NODE_ENV !== "production". Habilita o botao
   * "Gerar teste sem IA" que chama a rota dev-only e nao consome creditos
   * da OpenAI. Em producao essa prop e false e o botao nao e renderizado.
   */
  isDev: boolean;
}

// Retorna o ultimo dia do mes (1-indexed) no UTC.
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Retorna {dateFrom, dateTo} cobrindo o ultimo mes inteiro fechado em
// relacao a `now`. Ex.: now=2026-05-22 -> {2026-04-01, 2026-04-30}.
function defaultPreviousMonth(now: Date): { dateFrom: string; dateTo: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed; mes anterior em 1-indexed
  const prevMonth1 = month === 0 ? 12 : month;
  const prevYear = month === 0 ? year - 1 : year;
  const last = lastDayOfMonth(prevYear, prevMonth1);
  const mm = String(prevMonth1).padStart(2, "0");
  return {
    dateFrom: `${prevYear}-${mm}-01`,
    dateTo: `${prevYear}-${mm}-${String(last).padStart(2, "0")}`,
  };
}

const MONTH_NAMES_PT = [
  "Janeiro", "Fevereiro", "Marco", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

// Deriva label do periodo a partir de dateFrom/dateTo. "Abril/2026" quando o
// intervalo cobre exatamente um mes; "01/04/2026 a 31/05/2026" caso contrario.
function derivePeriodLabel(dateFrom: string, dateTo: string): string {
  const [yf, mf, df] = dateFrom.split("-").map(Number);
  const [yt, mt, dt] = dateTo.split("-").map(Number);
  if (!yf || !mf || !df || !yt || !mt || !dt) return `${dateFrom} a ${dateTo}`;
  const isSameMonth =
    yf === yt && mf === mt && df === 1 && dt === lastDayOfMonth(yt, mt);
  if (isSameMonth) {
    return `${MONTH_NAMES_PT[mf - 1]}/${yf}`;
  }
  const fmt = (y: number, m: number, d: number) =>
    `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
  return `${fmt(yf, mf, df)} a ${fmt(yt, mt, dt)}`;
}

export function BusinessIntelligenceClient({
  companies,
  canGenerate,
  isDev,
}: BusinessIntelligenceClientProps) {
  const { showToast } = useToast();

  const defaults = useMemo(() => defaultPreviousMonth(new Date()), []);

  const [companyId, setCompanyId] = useState<string>(
    companies.length === 1 ? companies[0].id : "",
  );
  const [dateFrom, setDateFrom] = useState<string>(defaults.dateFrom);
  const [dateTo, setDateTo] = useState<string>(defaults.dateTo);

  // `loadingMode` indica qual botao esta em andamento (ou null se nenhum).
  // Permite desabilitar o outro botao enquanto um esta processando, sem
  // confundir qual spinner mostrar.
  type LoadingMode = "ia" | "no-ai" | null;
  const [loadingMode, setLoadingMode] = useState<LoadingMode>(null);
  const [error, setError] = useState<string | null>(null);
  // `data` undefined -> componente cai no mock interno (preview visual).
  // Quando preenchido, vira dado real (mapeado da rota).
  const [data, setData] = useState<OnePageReportPreviewData | undefined>(
    undefined,
  );

  // Ref para o container do relatorio (capturado pelo html2canvas na
  // exportacao PDF). NAO inclui o card de filtros nem o alerta de erro —
  // apenas o conteudo do OnePageReportPreview.
  const reportRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  const loading = loadingMode !== null;
  const buttonDisabled =
    !canGenerate || loading || !companyId || !dateFrom || !dateTo;
  // Botao dev-only nao depende de canGenerate (mas ainda exige admin no
  // backend). Aqui no client deixamos disponivel para qualquer usuario que
  // veja a pagina em dev — o backend valida.
  const devButtonDisabled = loading || !companyId || !dateFrom || !dateTo;

  // Executa a chamada conforme o modo: "ia" usa a rota oficial que consome
  // creditos da OpenAI; "no-ai" usa a rota dev-only com analysis mockada.
  const runGenerate = async (mode: "ia" | "no-ai") => {
    if (!companyId || !dateFrom || !dateTo) return;
    setLoadingMode(mode);
    setError(null);

    const periodLabel = derivePeriodLabel(dateFrom, dateTo);
    const endpoint =
      mode === "ia"
        ? "/api/intelligence/one-page"
        : "/api/dev/intelligence/one-page-no-ai";

    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, dateFrom, dateTo, periodLabel }),
      });
      const payload = (await r.json().catch(() => null)) as
        | OnePageApiResponse
        | null;

      if (!r.ok || !payload) {
        const msg =
          payload?.error ??
          `Falha ao gerar relatório (HTTP ${r.status}).`;
        setError(msg);
        showToast({
          title: "Falha ao gerar relatório",
          description: msg,
          variant: "destructive",
        });
        // NAO sobrescreve `data`: mantemos o estado anterior (mock ou ultimo
        // sucesso). Regra explicita: nao misturar mock com dados parciais.
        return;
      }

      // Mapeia para o shape do componente visual e seta como dado ativo.
      const mapped = mapOnePageApiResponseToPreviewData(payload);
      setData(mapped);
      showToast({
        title:
          mode === "ia"
            ? "Relatório gerado"
            : "Relatório de teste gerado (sem IA)",
        description: `${mapped.cabecalho.empresa} • ${mapped.cabecalho.periodo}`,
        variant: "success",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro inesperado.";
      setError(msg);
      showToast({
        title: "Falha ao gerar relatório",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setLoadingMode(null);
    }
  };

  const handleGenerate = () => void runGenerate("ia");
  const handleGenerateNoAi = () => void runGenerate("no-ai");

  // ─── Export PDF ───────────────────────────────────────────────────────────
  //
  // Captura o DOM do relatorio com html2canvas (alta resolucao via scale=2)
  // e embute como imagem unica em PDF A4 paisagem via jsPDF. As bibliotecas
  // sao carregadas DINAMICAMENTE — saem do bundle inicial e so chegam ao
  // navegador na hora do clique. Custo do clique: ~250kb gz baixados +
  // ~1-2s para renderizar capture e gerar PDF.
  //
  // Single-page: a imagem capturada e escalada para caber inteira em UMA
  // pagina A4 paisagem. Escolhe entre fit-by-width ou fit-by-height de
  // forma que tudo fique visivel sem quebra de pagina.
  const sanitizeFilename = (s: string) =>
    s.replace(/[/\\?%*:|"<>\s]+/g, "_").replace(/_+/g, "_");

  const handleExportPdf = async () => {
    if (!reportRef.current) return;
    setExporting(true);
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
        // `onclone` roda no DOM clonado que o html2canvas usa para captura.
        // Forca `overflow: visible` em wrappers do recharts e SVGs internos —
        // sem isso os LabelList posicionados fora do plot area (position
        // "right" nas barras horizontais e "top" nas barras verticais) sao
        // clipados e nao aparecem no PDF.
        onclone: (clonedDoc) => {
          const selectors = [
            ".recharts-wrapper",
            ".recharts-surface",
            ".recharts-responsive-container",
            "svg",
          ];
          clonedDoc
            .querySelectorAll<HTMLElement | SVGElement>(selectors.join(","))
            .forEach((el) => {
              (el as HTMLElement).style.overflow = "visible";
              if ("setAttribute" in el) {
                el.setAttribute("overflow", "visible");
              }
            });
        },
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
        compress: true,
      });

      // A4 retrato (210 x 297 mm) — preenche a pagina inteira. A imagem do
      // relatorio e ancorada no canto superior esquerdo (0, 0) e esticada
      // para ocupar 210 mm de largura. A altura e proporcional ao aspect
      // do canvas (preserva proporcao, sem distorcao).
      //
      // Quando a altura proporcional excederia 297 mm, fazemos o caminho
      // inverso: ancorar pela altura (297 mm) e calcular largura. Garante
      // que tudo cabe em UMA pagina e ainda assim usa o maximo do espaco
      // disponivel.
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const canvasAspect = canvas.height / canvas.width;

      let imgWidth: number;
      let imgHeight: number;
      if (pdfWidth * canvasAspect <= pdfHeight) {
        // Fit-by-width: largura cheia, altura proporcional cabe na pagina.
        imgWidth = pdfWidth;
        imgHeight = pdfWidth * canvasAspect;
      } else {
        // Fit-by-height: altura cheia, largura proporcional.
        imgHeight = pdfHeight;
        imgWidth = pdfHeight / canvasAspect;
      }
      const xOffset = (pdfWidth - imgWidth) / 2;
      const yOffset = (pdfHeight - imgHeight) / 2;

      pdf.addImage(imgData, "PNG", xOffset, yOffset, imgWidth, imgHeight);

      const empresa = data?.cabecalho.empresa ?? "preview";
      const periodo = data?.cabecalho.periodo ?? "preview";
      const filename = sanitizeFilename(
        `OnePageReport_${empresa}_${periodo}.pdf`,
      );
      pdf.save(filename);

      showToast({
        title: "PDF gerado",
        description: filename,
        variant: "success",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro inesperado.";
      showToast({
        title: "Falha ao exportar PDF",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  const isPreviewState = data === undefined;

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
            <div className="space-y-1">
              <label
                htmlFor="bi-company"
                className="text-xs font-medium text-muted-foreground"
              >
                Empresa
              </label>
              <select
                id="bi-company"
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                disabled={loading}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Selecione...</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label
                htmlFor="bi-date-from"
                className="text-xs font-medium text-muted-foreground"
              >
                Data inicial
              </label>
              <input
                id="bi-date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                disabled={loading}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="bi-date-to"
                className="text-xs font-medium text-muted-foreground"
              >
                Data final
              </label>
              <input
                id="bi-date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                disabled={loading}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <span
                aria-hidden
                className="block text-xs font-medium opacity-0"
              >
                .
              </span>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  onClick={handleGenerate}
                  disabled={buttonDisabled}
                  className="w-full sm:w-auto"
                >
                  {loadingMode === "ia" ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Gerando relatório...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Gerar relatório
                    </>
                  )}
                </Button>
                {isDev ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleGenerateNoAi}
                    disabled={devButtonDisabled}
                    className="w-full sm:w-auto"
                    title="Usa a rota /api/dev/intelligence/one-page-no-ai — dados financeiros reais com análise mockada. Não consome créditos da OpenAI. Disponível apenas em desenvolvimento."
                  >
                    {loadingMode === "no-ai" ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Gerando teste...
                      </>
                    ) : (
                      <>
                        <FlaskConical className="mr-2 h-4 w-4" />
                        Gerar teste sem IA
                      </>
                    )}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleExportPdf}
                  disabled={loading || exporting}
                  className="w-full sm:w-auto"
                  title="Exporta o relatório atual como PDF em uma única página A4 paisagem."
                >
                  {exporting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Gerando PDF...
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-4 w-4" />
                      Exportar PDF
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>

          {!canGenerate ? (
            <p className="text-xs text-amber-700">
              Geração de relatório com IA disponível apenas para administradores.
              A prévia visual abaixo usa dados de exemplo.
            </p>
          ) : isPreviewState ? (
            <p className="text-xs text-muted-foreground">
              Selecione empresa e período e clique em <strong>Gerar relatório</strong> para
              produzir a análise com IA. A prévia abaixo usa dados de exemplo enquanto
              nenhum relatório foi gerado.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Erro */}
      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">Falha ao gerar relatório</div>
            <div className="text-xs">{error}</div>
          </div>
        </div>
      ) : null}

      {/* Preview / Relatorio (envolvido em div com ref para o export PDF) */}
      <div ref={reportRef} className="bg-background">
        <OnePageReportPreview data={data} />
      </div>
    </div>
  );
}
