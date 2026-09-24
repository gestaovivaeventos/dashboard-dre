"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";

import type { PreviaSetorResumo } from "@/lib/orcamento/actions/planejamento-categoria";
import { formatBRL } from "@/lib/orcamento/format";
import { cn } from "@/lib/utils";

/**
 * Prévia do SETOR embaixo da entrevista — como o orçamento dele está ficando,
 * atualizada a cada despesa confirmada.
 *
 * Mostra TODAS as categorias orçadas do setor (qualquer método), não só a que
 * está aberta: o gestor precisa ver o conjunto para decidir a próxima. A
 * categoria da tela vem primeiro e destacada.
 *
 * O subnível é o GRUPO, em ordem alfabética, com "Sem grupo" ao fim — ver
 * src/lib/orcamento/grupos.ts, que é quem ordena.
 */
export function PlanejamentoPreviaSetor({
  resumo,
  carregando,
  setorNome,
  year,
}: {
  resumo: PreviaSetorResumo | null;
  carregando: boolean;
  setorNome: string;
  year: number;
}) {
  const [abertas, setAbertas] = useState<Set<string>>(new Set());

  function alternar(chave: string) {
    setAbertas((prev) => {
      const próxima = new Set(prev);
      if (próxima.has(chave)) próxima.delete(chave);
      else próxima.add(chave);
      return próxima;
    });
  }

  return (
    <section className="rounded-xl border bg-card">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-3">
        <div>
          <h3 className="font-semibold">Prévia do setor</h3>
          <p className="text-xs text-muted-foreground">
            {setorNome ? `${setorNome} · ` : ""}todas as categorias orçadas para {year}. Atualiza a
            cada despesa confirmada.
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Total do setor</div>
          <div className="text-lg font-semibold tabular-nums">
            {carregando && !resumo ? "—" : formatBRL(resumo?.total ?? 0)}
          </div>
        </div>
      </header>

      {carregando && !resumo ? (
        <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Calculando…
        </div>
      ) : !resumo || resumo.categorias.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">
          Nada orçado neste setor ainda. As despesas que você confirmar aparecem aqui.
        </p>
      ) : (
        <ul className="divide-y">
          {resumo.categorias.map((c) => {
            const chave = `${c.metodo}|${c.categoria}`;
            const aberta = abertas.has(chave);
            const temDetalhe = c.grupos.length > 0;
            return (
              <li key={chave} className={cn(c.atual && "bg-emerald-500/5")}>
                <button
                  type="button"
                  onClick={() => temDetalhe && alternar(chave)}
                  disabled={!temDetalhe}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/40 disabled:cursor-default disabled:hover:bg-transparent"
                >
                  {temDetalhe ? (
                    aberta ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )
                  ) : (
                    <span className="w-3.5 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-sm", c.atual && "font-semibold")}>
                      {c.categoria}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {c.metodoLabel}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-medium tabular-nums">
                    {formatBRL(c.total)}
                  </span>
                </button>

                {aberta && (
                  <div className="space-y-2 border-t bg-muted/20 px-4 py-2.5 pl-9">
                    {c.grupos.map((g) => (
                      <div key={g.nome}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span
                            className={cn(
                              "text-xs font-medium",
                              g.grupoId === null && "text-amber-700",
                            )}
                            title={
                              g.grupoId === null
                                ? "Despesas sem grupo. O administrador cadastra grupos em Configuração › Grupos de despesas."
                                : undefined
                            }
                          >
                            {g.nome}
                          </span>
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {formatBRL(g.total)}
                          </span>
                        </div>
                        <ul className="mt-0.5 space-y-0.5 pl-3">
                          {g.itens.map((i, idx) => (
                            <li
                              key={`${i.nome}-${idx}`}
                              className="flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground"
                            >
                              <span className="min-w-0 truncate" title={i.detalhe ?? undefined}>
                                {i.nome}
                              </span>
                              <span className="shrink-0 tabular-nums">{formatBRL(i.total)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
