"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { MESES_CURTOS, type PreviaResultado } from "@/lib/orcamento/pessoal-calc";
import { cn } from "@/lib/utils";

/** Milhares sem "R$" — numa tabela de 13 colunas o símbolo só atrapalha. */
export function num(value: number): string {
  if (!value) return "—";
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

const STICKY = "sticky left-0 z-10 border-r px-3";

/**
 * Matriz 12 meses × linhas da prévia. Compartilhada pela aba da empresa e pela
 * aba de um colaborador só — a única diferença entre elas é o insumo.
 * A linha de Benefícios abre em um item por benefício quando há detalhe.
 */
export function PreviaTabela({
  previa,
  mostrarHeadcount = true,
}: {
  previa: PreviaResultado;
  mostrarHeadcount?: boolean;
}) {
  const [beneficiosAbertos, setBeneficiosAbertos] = useState(false);
  const temDetalhe = previa.beneficiosDetalhe.length > 0;

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="min-w-[1100px] w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <th className={cn(STICKY, "bg-muted/40 py-2 text-left")}>Linha</th>
            {MESES_CURTOS.map((mes) => (
              <th key={mes} className="border-r px-2 py-2 text-right">
                {mes}
              </th>
            ))}
            <th className="px-3 py-2 text-right">Ano</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {previa.linhas.map((linha) => {
            const expansivel = linha.key === "beneficios" && temDetalhe;
            return (
              <Fragment key={linha.key}>
                <tr className="hover:bg-muted/20">
                  <td className={cn(STICKY, "bg-background py-1.5 font-medium")}>
                    {expansivel ? (
                      <button
                        type="button"
                        onClick={() => setBeneficiosAbertos((v) => !v)}
                        className="-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted"
                        aria-expanded={beneficiosAbertos}
                      >
                        {beneficiosAbertos ? (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                        {linha.label}
                      </button>
                    ) : (
                      linha.label
                    )}
                  </td>
                  {linha.meses.map((valor, m) => (
                    <td key={m} className="border-r px-2 py-1.5 text-right tabular-nums">
                      {num(valor)}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                    {num(linha.total)}
                  </td>
                </tr>

                {expansivel &&
                  beneficiosAbertos &&
                  previa.beneficiosDetalhe.map((sub) => (
                    <tr key={sub.key} className="bg-emerald-500/[0.04] text-xs">
                      <td className={cn(STICKY, "bg-background py-1.5 pl-9 text-muted-foreground")}>
                        {sub.label}
                      </td>
                      {sub.meses.map((valor, m) => (
                        <td
                          key={m}
                          className="border-r px-2 py-1.5 text-right tabular-nums text-muted-foreground"
                        >
                          {num(valor)}
                        </td>
                      ))}
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                        {num(sub.total)}
                      </td>
                    </tr>
                  ))}
              </Fragment>
            );
          })}

          <tr className="border-t-2 bg-muted/30 font-semibold">
            <td className={cn(STICKY, "bg-muted/30 py-2")}>Total</td>
            {previa.totalMeses.map((valor, m) => (
              <td key={m} className="border-r px-2 py-2 text-right tabular-nums">
                {num(valor)}
              </td>
            ))}
            <td className="px-3 py-2 text-right tabular-nums">{num(previa.totalAno)}</td>
          </tr>

          {mostrarHeadcount && (
            <tr className="text-xs text-muted-foreground">
              <td className={cn(STICKY, "bg-background py-1.5")}>Headcount CLT</td>
              {previa.headcountClt.map((qtd, m) => (
                <td key={m} className="border-r px-2 py-1.5 text-right tabular-nums">
                  {qtd || "—"}
                </td>
              ))}
              <td className="px-3 py-1.5 text-right">—</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
