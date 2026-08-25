"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, TriangleAlert, Eye, EyeOff, Info, Download } from "lucide-react";

import {
  getPreviaOrcamento,
  type PreviaOrcamentoData,
  type PreviaDreLinha,
} from "@/lib/orcamento/actions/previa-orcamento";
import { downloadPreviaOrcamentoXlsx } from "@/lib/orcamento/previa-orcamento-export";
import { formatBRL } from "@/lib/orcamento/format";
import { cn } from "@/lib/utils";

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

/** Célula de valor: zero fica apagado, para a estrutura respirar. */
function Valor({ v, className }: { v: number; className?: string }) {
  return (
    <span className={cn("tabular-nums", v === 0 && "text-muted-foreground/40", className)}>
      {v === 0 ? "—" : formatBRL(v)}
    </span>
  );
}

function LinhaDre({ linha }: { linha: PreviaDreLinha }) {
  const destaque = linha.isSummary || linha.isCalculado;
  const resultado = linha.code === "11";
  // Fundo OPACO (não translúcido): as colunas fixas ficam por cima das células
  // de mês quando a tabela rola na horizontal — com fundo transparente o valor
  // do mês vazava por baixo do total do ano. Mesmo tom na linha inteira e nas
  // células fixas, para não haver emenda de cor.
  const surface = resultado
    ? "bg-emerald-100 dark:bg-emerald-950"
    : destaque
      ? "bg-muted"
      : "bg-card";
  return (
    <tr
      className={cn(
        "border-b last:border-0",
        surface,
        destaque && "font-semibold",
        resultado && "font-bold",
      )}
    >
      {/* Nome (coluna fixa à esquerda) */}
      <td className={cn("sticky left-0 z-10 whitespace-nowrap border-r px-3 py-1.5", surface)}>
        <span style={{ paddingLeft: `${Math.max(0, linha.level - 1) * 14}px` }} className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground tabular-nums">{linha.code}</span>
          <span className={cn(linha.isReceita && linha.totalAno === 0 && "text-muted-foreground")}>
            {linha.name}
          </span>
          {linha.isReceita && (
            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-normal text-amber-600 dark:text-amber-500">
              sem método de receita
            </span>
          )}
        </span>
      </td>
      {/* 12 meses */}
      {linha.meses.map((v, m) => (
        <td key={m} className="px-3 py-1.5 text-right">
          <Valor v={v} />
        </td>
      ))}
      {/* Total do ano (coluna fixa à direita) */}
      <td className={cn("sticky right-0 z-10 border-l px-3 py-1.5 text-right", surface)}>
        <Valor v={linha.totalAno} className="font-semibold" />
      </td>
    </tr>
  );
}

export function PreviaOrcamentoView({
  companyId,
  year,
  empresaLabel,
}: {
  companyId: string;
  year: number;
  empresaLabel?: string;
}) {
  const [data, setData] = useState<PreviaOrcamentoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [ocultarZeros, setOcultarZeros] = useState(true);
  const [exportando, setExportando] = useState(false);

  useEffect(() => {
    let cancelado = false;
    setLoading(true);
    setError(null);
    setNeedsMigration(false);
    void getPreviaOrcamento(companyId, year).then((res) => {
      if (cancelado) return;
      setLoading(false);
      if (res.needsMigration) {
        setNeedsMigration(true);
        return;
      }
      if (res.error || !res.data) {
        setError(res.error ?? "Falha ao montar a prévia.");
        return;
      }
      setData(res.data);
    });
    return () => {
      cancelado = true;
    };
  }, [companyId, year]);

  const linhasVisiveis = useMemo(() => {
    if (!data) return [];
    if (!ocultarZeros) return data.linhas;
    // Esconde folhas zeradas, mas mantém as totalizadoras/calculadas (a espinha
    // da DRE) mesmo quando zeram, para a estrutura continuar legível.
    return data.linhas.filter(
      (l) => l.totalAno !== 0 || l.isSummary || l.isCalculado || l.hasChildren,
    );
  }, [data, ocultarZeros]);

  // Exporta o que está na tela (respeita o filtro de linhas zeradas), na mesma
  // ordem. O import do xlsx é dinâmico, então nada pesa no bundle da rota.
  async function handleExport() {
    if (exportando || linhasVisiveis.length === 0) return;
    setExportando(true);
    try {
      await downloadPreviaOrcamentoXlsx(linhasVisiveis, {
        empresaLabel: empresaLabel ?? companyId,
        ano: year,
      });
    } finally {
      setExportando(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border p-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Montando a prévia do orçamento…
      </div>
    );
  }

  if (needsMigration) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
        <p className="font-medium">Migration pendente</p>
        <p className="mt-1 text-muted-foreground">
          As tabelas do módulo Orçamento ainda não foram aplicadas. Rode o{" "}
          <code className="rounded bg-muted px-1 py-0.5">supabase db push</code> para habilitar a prévia.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
    );
  }

  if (!data) return null;

  const { resumo, pessoalNaoClassificado, categoriasNaoMapeadas } = data;

  return (
    <div className="space-y-4">
      {/* Resumo + controles */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span className="text-muted-foreground">
            Despesa orçada:{" "}
            <span className="font-semibold text-foreground tabular-nums">
              {formatBRL(resumo.totalDespesa)}
            </span>
          </span>
          {resumo.mediaCategorias > 0 && (
            <span className="text-muted-foreground">
              Média: {resumo.mediaCategorias} categoria(s)
              {resumo.mediaSemValor > 0 && (
                <span className="text-amber-600 dark:text-amber-500">
                  {" "}
                  · {resumo.mediaSemValor} sem valor
                </span>
              )}
            </span>
          )}
          {resumo.valorFixoCategorias > 0 && (
            <span className="text-muted-foreground">
              Valor fixo: {resumo.valorFixoCategorias} categoria(s)
              {resumo.valorFixoSemValor > 0 && (
                <span className="text-amber-600 dark:text-amber-500">
                  {" "}
                  · {resumo.valorFixoSemValor} sem valor
                </span>
              )}
            </span>
          )}
          {resumo.planejamentoCategorias > 0 && (
            <span className="text-muted-foreground">
              Planejamento dos sócios: {resumo.planejamentoCategorias} categoria(s)
              {resumo.planejamentoSemValor > 0 && (
                <span className="text-amber-600 dark:text-amber-500">
                  {" "}
                  · {resumo.planejamentoSemValor} sem valor
                </span>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOcultarZeros((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {ocultarZeros ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            {ocultarZeros ? "Mostrar linhas zeradas" : "Ocultar linhas zeradas"}
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exportando || linhasVisiveis.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {exportando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Exportar Excel
          </button>
        </div>
      </div>

      {/* Avisos de valores que não caíram na DRE */}
      {(pessoalNaoClassificado.length > 0 || categoriasNaoMapeadas.length > 0) && (
        <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <div className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-500">
            <TriangleAlert className="h-4 w-4" />
            Valores fora da DRE
          </div>
          {categoriasNaoMapeadas.length > 0 && (
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">
                {categoriasNaoMapeadas.length} categoria(s) por média
              </span>{" "}
              sem linha da DRE — ligue-as em <span className="font-medium">Mapeamento</span> (Financeiro):{" "}
              {categoriasNaoMapeadas
                .map((o) => `${o.chave} (${formatBRL(o.totalAno)})`)
                .join(", ")}
              .
            </p>
          )}
          {pessoalNaoClassificado.length > 0 && (
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">
                {pessoalNaoClassificado.length} rótulo(s) do pessoal
              </span>{" "}
              sem conta — ligue em <span className="font-medium">Mapeamento → Linhas do Orçamento</span>:{" "}
              {pessoalNaoClassificado
                .map((o) => `${o.chave} (${formatBRL(o.totalAno)})`)
                .join(", ")}
              .
            </p>
          )}
        </div>
      )}

      {!resumo.temReceita && (
        <div className="flex items-start gap-1.5 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          A receita ainda não é orçada por nenhum método, então as linhas de receita saem zeradas e o
          Resultado reflete só as despesas.
        </div>
      )}

      {/* Tabela DRE — rolagem própria (x e y) para congelar o cabeçalho no topo
          e a 1ª/última coluna nas laterais. Só `overflow-x` não seguraria o
          `sticky top`, porque o eixo vertical continuaria rolando com a página. */}
      <div className="max-h-[75vh] overflow-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="sticky left-0 top-0 z-30 border-b border-r bg-muted px-3 py-2 text-left font-medium">
                Linha
              </th>
              {MESES.map((m) => (
                <th key={m} className="sticky top-0 z-20 border-b bg-muted px-3 py-2 text-right font-medium">
                  {m}
                </th>
              ))}
              <th className="sticky right-0 top-0 z-30 border-b border-l bg-muted px-3 py-2 text-right font-medium">
                Ano
              </th>
            </tr>
          </thead>
          <tbody>
            {linhasVisiveis.map((linha) => (
              <LinhaDre key={linha.id} linha={linha} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
