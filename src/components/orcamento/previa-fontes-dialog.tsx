"use client";

import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, TriangleAlert, X } from "lucide-react";

import type {
  PreviaDreLinha,
  PreviaFonte,
  PreviaFonteItem,
} from "@/lib/orcamento/actions/previa-orcamento";
import { formatBRL } from "@/lib/orcamento/format";
import { cn } from "@/lib/utils";

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function Valor({ v }: { v: number }) {
  return (
    <span className={cn("tabular-nums", v === 0 && "text-muted-foreground/40")}>
      {v === 0 ? "—" : formatBRL(v)}
    </span>
  );
}

/**
 * Drilldown da Prévia: abre a composição de uma linha da DRE — cada origem que
 * a alimenta, com os 12 meses e um atalho para a tela que a produziu.
 *
 * Uma linha totalizadora herda as origens dos descendentes; linha calculada por
 * fórmula não tem drilldown (ver a action). O atalho abre em NOVA ABA de
 * propósito: quem confere a prévia quer corrigir um valor e voltar, não perder
 * a leitura da DRE inteira.
 */
export function PreviaFontesDialog({
  linha,
  onClose,
}: {
  linha: PreviaDreLinha;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const somaFontes = linha.fontes.reduce((acc, f) => acc + f.totalAno, 0);
  // A linha pode ter valor sem origem listável. Mostrar a diferença evita a
  // leitura errada de que a lista explica o total inteiro.
  const diferenca = linha.totalAno - somaFontes;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-5xl overflow-hidden rounded-lg border bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Origem do valor</p>
            <p className="truncate text-base font-semibold">
              <span className="mr-1.5 text-sm tabular-nums text-muted-foreground">{linha.code}</span>
              {linha.name}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {linha.fontes.length} origem(ns) · total do ano{" "}
              <span className="font-medium tabular-nums text-foreground">
                {formatBRL(linha.totalAno)}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[65vh] overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b bg-muted text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium">
                  Origem
                </th>
                {MESES.map((m) => (
                  <th key={m} className="px-2 py-2 text-right font-medium">
                    {m}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium">Ano</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {linha.fontes.map((fonte, idx) => (
                <FonteRow key={fonte.metodo + "|" + fonte.chave + "|" + idx} fonte={fonte} />
              ))}
            </tbody>
          </table>
        </div>

        {Math.abs(diferenca) > 0.005 && (
          <p className="border-t bg-amber-500/5 px-4 py-2 text-[11px] text-muted-foreground">
            <TriangleAlert className="mr-1 inline h-3 w-3 text-amber-600" />
            As origens listadas somam {formatBRL(somaFontes)} —{" "}
            {formatBRL(Math.abs(diferenca))} do total desta linha{" "}
            {diferenca > 0 ? "não têm origem identificada" : "estão contados a mais"}.
          </p>
        )}
      </div>
    </div>
  );
}

function FonteRow({ fonte }: { fonte: PreviaFonte }) {
  const [aberto, setAberto] = useState(false);
  const podeAbrir = fonte.itens.length > 0;

  return (
    <Fragment>
      <tr
        className={cn("hover:bg-muted/30", podeAbrir && "cursor-pointer")}
        onClick={podeAbrir ? () => setAberto((v) => !v) : undefined}
      >
        <td className="sticky left-0 z-10 bg-card px-3 py-2">
          <div className="flex items-start gap-1.5">
            {podeAbrir ? (
              aberto ? (
                <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )
            ) : (
              <span className="w-3.5 shrink-0" />
            )}
            <div className="flex flex-col">
              <span className="font-medium">{fonte.chave}</span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {fonte.metodoLabel}
                {podeAbrir ? ` · ${fonte.itens.length} item(ns)` : ""}
              </span>
            </div>
          </div>
        </td>
        {fonte.meses.map((v, m) => (
          <td key={m} className="px-2 py-2 text-right">
            <Valor v={v} />
          </td>
        ))}
        <td className="px-3 py-2 text-right font-semibold tabular-nums">
          {formatBRL(fonte.totalAno)}
        </td>
        <td className="px-2 py-2 text-right">
          <a
            href={fonte.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            title={"Abrir " + fonte.metodoLabel + " em nova aba"}
          >
            <ExternalLink className="h-3 w-3" />
            abrir
          </a>
        </td>
      </tr>

      {aberto &&
        fonte.itens.map((item, idx) => (
          <ItemRow key={item.nome + "|" + idx} item={item} />
        ))}
    </Fragment>
  );
}

/** 3º nível: o que compõe uma origem — o item planejado, o contrato, a pessoa. */
function ItemRow({ item }: { item: PreviaFonteItem }) {
  return (
    <tr className="bg-muted/20 text-[11px]">
      <td className="sticky left-0 z-10 bg-card px-3 py-1.5 pl-9">
        <div className="flex flex-col">
          <span>{item.nome}</span>
          {item.detalhe && (
            <span className="text-[10px] text-muted-foreground">{item.detalhe}</span>
          )}
        </div>
      </td>
      {item.meses.map((v, m) => (
        <td key={m} className="px-2 py-1.5 text-right text-muted-foreground">
          <Valor v={v} />
        </td>
      ))}
      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
        {formatBRL(item.totalAno)}
      </td>
      <td className="px-2 py-1.5" />
    </tr>
  );
}
