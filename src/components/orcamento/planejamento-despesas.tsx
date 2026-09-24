"use client";

import { useState, useTransition } from "react";
import { Ban, Check, Pencil, Trash2, X } from "lucide-react";

import {
  editarDespesa,
  removerDespesa,
  type PlanejamentoDespesaLinha,
  type PlanejamentoGrupoOption,
} from "@/lib/orcamento/actions/planejamento-categoria";
import { formatBRL, numberToInput, parseBrNumber } from "@/lib/orcamento/format";
import { agruparPorGrupo } from "@/lib/orcamento/grupos";
import { PERIODICIDADES, type Periodicidade } from "@/lib/orcamento/planejamento-calc";
import { cn } from "@/lib/utils";

const MESES = [
  "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez",
];

const INPUT_CLS =
  "rounded-md border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
const BTN_GHOST =
  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors";

/**
 * As despesas ORÇADAS da categoria × setor — o número que vai para a Prévia.
 *
 * Agrupadas por GRUPO em ordem alfabética, com "Sem grupo" ao fim (a ordenação
 * é a de src/lib/orcamento/grupos.ts, compartilhada com a Prévia: se as duas
 * telas ordenassem por conta própria, o mesmo orçamento pareceria dois).
 *
 * Despesa CANCELADA pela diretoria continua visível, riscada e com o motivo —
 * o gestor precisa ver o que foi cortado para responder na etapa de retorno.
 */
export function PlanejamentoDespesas({
  companyId,
  year,
  despesas,
  grupos,
  podeEscrever,
  onMudou,
}: {
  companyId: string;
  year: number;
  despesas: PlanejamentoDespesaLinha[];
  grupos: PlanejamentoGrupoOption[];
  podeEscrever: boolean;
  onMudou: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState({
    descricao: "",
    grupoId: "" as string,
    valor: "",
    periodicidade: "mensal" as Periodicidade,
    mesInicio: 1,
    mesFim: "" as string,
  });

  const ativas = despesas.filter((d) => !d.cancelado);
  const total = ativas.reduce((a, d) => a + d.totalAno, 0);

  const agrupadas = agruparPorGrupo(
    despesas.map((d) => ({ ...d, grupoId: d.grupoId, grupoNome: d.grupoNome })),
  );

  function abrirEdicao(d: PlanejamentoDespesaLinha) {
    setEditandoId(d.id);
    setRascunho({
      descricao: d.descricao,
      grupoId: d.grupoId ?? "",
      valor: numberToInput(d.valor),
      periodicidade: d.periodicidade,
      mesInicio: d.mesInicio,
      mesFim: d.mesFim == null ? "" : String(d.mesFim),
    });
  }

  function salvar(d: PlanejamentoDespesaLinha) {
    const valor = parseBrNumber(rascunho.valor);
    if (valor == null || Number.isNaN(valor)) {
      setErro("Informe um valor válido.");
      return;
    }
    setErro(null);
    startTransition(async () => {
      const res = await editarDespesa(companyId, year, d.id, {
        descricao: rascunho.descricao,
        grupoId: rascunho.grupoId || null,
        valor,
        periodicidade: rascunho.periodicidade,
        mesInicio: rascunho.mesInicio,
        mesFim: rascunho.mesFim ? Number(rascunho.mesFim) : null,
        fornecedor: d.fornecedor,
        origem: d.origem,
        baseId: null,
      });
      if (res.error) {
        setErro(res.error);
        return;
      }
      setEditandoId(null);
      onMudou();
    });
  }

  function excluir(d: PlanejamentoDespesaLinha) {
    if (!window.confirm(`Remover "${d.descricao}" do orçamento?`)) return;
    setErro(null);
    startTransition(async () => {
      const res = await removerDespesa(companyId, year, d.id);
      if (res.error) {
        setErro(res.error);
        return;
      }
      onMudou();
    });
  }

  return (
    <section className="rounded-xl border bg-card">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-3">
        <div>
          <h3 className="font-semibold">Despesas orçadas</h3>
          <p className="text-xs text-muted-foreground">
            {ativas.length} despesa(s) nesta categoria para {year}.
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Total da categoria</div>
          <div className="text-lg font-semibold tabular-nums">{formatBRL(total)}</div>
        </div>
      </header>

      {erro && <div className="bg-destructive/10 px-4 py-2 text-xs text-destructive">{erro}</div>}

      {despesas.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">
          Nada orçado ainda. Conduza a entrevista ao lado — cada despesa que você confirmar aparece
          aqui.
        </p>
      ) : (
        <div className="divide-y">
          {agrupadas.map((g) => (
            <div key={g.grupoId ?? "sem"}>
              <div className="flex items-baseline justify-between gap-2 bg-muted/30 px-4 py-1.5">
                <span
                  className={cn(
                    "text-xs font-semibold",
                    g.grupoId === null && "text-amber-700",
                  )}
                  title={
                    g.grupoId === null
                      ? "Sem grupo: a despesa aparece assim na Prévia. Peça ao administrador para cadastrar o grupo, ou escolha um na edição."
                      : undefined
                  }
                >
                  {g.nome}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatBRL(
                    g.itens.filter((i) => !i.cancelado).reduce((a, i) => a + i.totalAno, 0),
                  )}
                </span>
              </div>

              <ul>
                {g.itens.map((d) => {
                  const editando = editandoId === d.id;
                  if (editando) {
                    return (
                      <li key={d.id} className="space-y-2 px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            value={rascunho.descricao}
                            onChange={(e) =>
                              setRascunho((r) => ({ ...r, descricao: e.target.value }))
                            }
                            autoFocus
                            className={INPUT_CLS + " min-w-[12rem] flex-1"}
                          />
                          <select
                            value={rascunho.grupoId}
                            onChange={(e) =>
                              setRascunho((r) => ({ ...r, grupoId: e.target.value }))
                            }
                            className={INPUT_CLS}
                          >
                            <option value="">— sem grupo —</option>
                            {grupos.map((gr) => (
                              <option key={gr.id} value={gr.id}>
                                {gr.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="flex items-center gap-1 text-xs text-muted-foreground">
                            R$
                            <input
                              value={rascunho.valor}
                              onChange={(e) =>
                                setRascunho((r) => ({ ...r, valor: e.target.value }))
                              }
                              className={INPUT_CLS + " w-28 text-right"}
                            />
                          </label>
                          <select
                            value={rascunho.periodicidade}
                            onChange={(e) =>
                              setRascunho((r) => ({
                                ...r,
                                periodicidade: e.target.value as Periodicidade,
                              }))
                            }
                            className={INPUT_CLS}
                          >
                            {PERIODICIDADES.map((p) => (
                              <option key={p.key} value={p.key}>
                                {p.label}
                              </option>
                            ))}
                          </select>
                          <label className="flex items-center gap-1 text-xs text-muted-foreground">
                            de
                            <select
                              value={rascunho.mesInicio}
                              onChange={(e) =>
                                setRascunho((r) => ({ ...r, mesInicio: Number(e.target.value) }))
                              }
                              className={INPUT_CLS}
                            >
                              {MESES.map((m, i) => (
                                <option key={m} value={i + 1}>
                                  {m}
                                </option>
                              ))}
                            </select>
                          </label>
                          {rascunho.periodicidade !== "anual" && (
                            <label className="flex items-center gap-1 text-xs text-muted-foreground">
                              até
                              <select
                                value={rascunho.mesFim}
                                onChange={(e) =>
                                  setRascunho((r) => ({ ...r, mesFim: e.target.value }))
                                }
                                className={INPUT_CLS}
                              >
                                <option value="">dez (todo o ano)</option>
                                {MESES.map((m, i) => (
                                  <option key={m} value={i + 1}>
                                    {m}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          <div className="ml-auto flex items-center gap-1">
                            <button
                              onClick={() => salvar(d)}
                              disabled={isPending}
                              className={BTN_GHOST + " text-green-700"}
                            >
                              <Check className="h-3.5 w-3.5" /> Salvar
                            </button>
                            <button onClick={() => setEditandoId(null)} className={BTN_GHOST}>
                              <X className="h-3.5 w-3.5" /> Cancelar
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  }

                  return (
                    <li
                      key={d.id}
                      className={cn(
                        "flex items-center gap-2 px-4 py-2",
                        d.cancelado && "opacity-60",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className={cn("truncate text-sm", d.cancelado && "line-through")}>
                          {d.descricao}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {formatBRL(d.valor)} {d.periodicidade} · a partir de{" "}
                          {MESES[d.mesInicio - 1]}
                          {d.periodicidade !== "anual" && d.mesFim != null && d.mesFim < 12
                            ? ` até ${MESES[d.mesFim - 1]}`
                            : ""}
                          {d.origem === "nova" ? " · nova" : ""}
                          {d.cancelado && d.canceladoMotivo
                            ? ` · cancelada: ${d.canceladoMotivo}`
                            : ""}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 text-sm font-medium tabular-nums",
                          d.cancelado && "line-through",
                        )}
                      >
                        {formatBRL(d.totalAno)}
                      </span>
                      {podeEscrever && !d.cancelado && (
                        <div className="flex shrink-0 items-center gap-0.5">
                          {d.travado ? (
                            <span
                              title="Item travado pela diretoria na validação."
                              className="inline-flex items-center gap-1 text-[11px] text-amber-700"
                            >
                              <Ban className="h-3 w-3" /> travado
                            </span>
                          ) : (
                            <>
                              <button
                                onClick={() => abrirEdicao(d)}
                                disabled={isPending}
                                className={BTN_GHOST}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => excluir(d)}
                                disabled={isPending}
                                className={BTN_GHOST + " hover:text-destructive"}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
