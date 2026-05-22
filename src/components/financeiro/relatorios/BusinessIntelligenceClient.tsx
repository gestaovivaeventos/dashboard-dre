"use client";

import { useMemo, useState } from "react";
import { AlertCircle, FlaskConical, Loader2, Sparkles } from "lucide-react";

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

      {/* Preview / Relatorio */}
      <OnePageReportPreview data={data} />
    </div>
  );
}
