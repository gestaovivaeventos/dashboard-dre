"use client";

import { useState, useTransition } from "react";
import { Check, Download, EyeOff, Loader2, Plus, Trash2, X } from "lucide-react";

import {
  adicionarLinhaBase,
  finalizarBase,
  removerLinhaBase,
  salvarContextoAdmin,
  salvarLinhaBase,
  semearBasePlanejamento,
  type PlanejamentoBaseLinha,
  type PlanejamentoGrupoOption,
} from "@/lib/orcamento/actions/planejamento-categoria";
import { formatBRL, numberToInput, parseBrNumber } from "@/lib/orcamento/format";
import { cn } from "@/lib/utils";

const INPUT_CLS =
  "w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
const BTN_GHOST =
  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors";

interface Props {
  companyId: string;
  year: number;
  categoryCode: string;
  categoryName: string;
  setorId: string | null;
  base: PlanejamentoBaseLinha[];
  baseSalva: boolean;
  contextoAdmin: string;
  grupos: PlanejamentoGrupoOption[];
  isAdmin: boolean;
  onMudou: () => void;
}

/**
 * ETAPA 1 — a base do ano anterior.
 *
 * Quem monta é o ADMINISTRADOR; o gestor só lê. São duas colunas apenas, por
 * decisão do dono do projeto: nome da despesa (editável, porque o nome que vem
 * da Omie costuma ser o do fornecedor) e o valor pago no ano. A base é
 * HISTÓRIA, não orçamento — por isso não tem periodicidade nem mês: quem produz
 * número é a entrevista.
 *
 * "Desconsiderar" não apaga: a linha fica riscada, some da entrevista e não
 * volta a ser sugerida na próxima semeadura — que casa por FORNECEDOR, e é isso
 * que preserva a curadoria já feita.
 */
export function PlanejamentoBaseEditor({
  companyId,
  year,
  categoryCode,
  categoryName,
  setorId,
  base,
  baseSalva,
  contextoAdmin,
  grupos,
  isAdmin,
  onMudou,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editNome, setEditNome] = useState("");
  const [editValor, setEditValor] = useState("");
  const [novoNome, setNovoNome] = useState("");
  const [novoValor, setNovoValor] = useState("");
  const [contexto, setContexto] = useState(contextoAdmin);
  const [contextoAberto, setContextoAberto] = useState(false);

  const incluidas = base.filter((b) => b.incluir);
  const total = incluidas.reduce((a, b) => a + b.valorAno, 0);

  function run(acao: () => Promise<{ error?: string; aviso?: string }>, msgOk: string) {
    setFeedback(null);
    startTransition(async () => {
      const res = await acao();
      if (res?.error) {
        setFeedback({ ok: false, msg: res.error });
        return;
      }
      setFeedback({ ok: true, msg: res?.aviso ? `${msgOk} ${res.aviso}` : msgOk });
      onMudou();
    });
  }

  function semear() {
    run(async () => {
      const res = await semearBasePlanejamento(companyId, year, categoryCode, setorId);
      if (res.error) return res;
      return {
        aviso:
          res.inseridos === 0
            ? `Nenhum fornecedor novo em ${year - 1}.${res.aviso ? ` ${res.aviso}` : ""}`
            : `${res.inseridos} linha(s) trazida(s) de ${year - 1}.${res.aviso ? ` ${res.aviso}` : ""}`,
      };
    }, "");
  }

  function salvarEdicao(linha: PlanejamentoBaseLinha) {
    const valor = parseBrNumber(editValor);
    if (valor != null && Number.isNaN(valor)) {
      setFeedback({ ok: false, msg: "Valor inválido." });
      return;
    }
    run(
      () =>
        salvarLinhaBase(linha.id, {
          nome: editNome.trim(),
          valorAno: valor ?? 0,
        }),
      "Linha salva.",
    );
    setEditandoId(null);
  }

  return (
    <section className="rounded-xl border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h3 className="font-semibold">
            Base — o que saiu em {year - 1}
            {baseSalva && (
              <span className="ml-2 inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800">
                finalizada
              </span>
            )}
          </h3>
          <p className="text-xs text-muted-foreground">
            {isAdmin
              ? "Você monta esta base; o gestor só a consulta. É a referência que a IA usa na entrevista."
              : "Montada pela administração. É só referência — o orçamento sai da entrevista."}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">
            {incluidas.length} linha(s) considerada(s)
          </div>
          <div className="font-semibold tabular-nums">{formatBRL(total)}</div>
        </div>
      </header>

      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/20 px-4 py-2.5">
          <button onClick={semear} disabled={isPending} className={BTN_GHOST}>
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Trazer de {year - 1}
          </button>
          <button
            onClick={() => setContextoAberto((v) => !v)}
            disabled={isPending}
            className={BTN_GHOST}
          >
            Contexto para a IA{contexto.trim() ? " ✓" : ""}
          </button>
          <div className="ml-auto">
            <button
              onClick={() =>
                run(
                  () =>
                    finalizarBase(
                      companyId,
                      year,
                      categoryCode,
                      setorId,
                      categoryName,
                      !baseSalva,
                    ),
                  baseSalva ? "Base reaberta." : "Base finalizada.",
                )
              }
              disabled={isPending}
              className={cn(
                BTN_GHOST,
                !baseSalva && "bg-emerald-600 text-white hover:bg-emerald-700 hover:text-white",
              )}
            >
              {baseSalva ? "Reabrir base" : "Finalizar base"}
            </button>
          </div>
        </div>
      )}

      {isAdmin && contextoAberto && (
        <div className="space-y-2 border-b bg-muted/10 px-4 py-3">
          <label className="text-xs font-medium">
            Direcionamento para a IA nesta categoria e setor
          </label>
          <textarea
            value={contexto}
            onChange={(e) => setContexto(e.target.value)}
            rows={3}
            placeholder="Ex.: o contrato do Trello não será renovado; migrar para o Notion a partir de março."
            className={INPUT_CLS}
          />
          <p className="text-[11px] text-muted-foreground">
            A IA lê isto antes de tudo e não contradiz. Use para decisões já tomadas, tetos de valor
            e trocas de fornecedor.
          </p>
          <button
            onClick={() =>
              run(
                () =>
                  salvarContextoAdmin(
                    companyId,
                    year,
                    categoryCode,
                    setorId,
                    categoryName,
                    contexto,
                  ),
                "Contexto salvo.",
              )
            }
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Salvar contexto
          </button>
        </div>
      )}

      {feedback && (
        <div
          className={cn(
            "px-4 py-2 text-xs",
            feedback.ok ? "bg-green-500/10 text-green-700" : "bg-destructive/10 text-destructive",
          )}
        >
          {feedback.msg}
        </div>
      )}

      {base.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">
          {isAdmin
            ? `Base vazia. Use "Trazer de ${year - 1}" para buscar os fornecedores da Omie, ou acrescente linhas à mão.`
            : `Sem base cadastrada para ${year - 1}. A entrevista será aberta.`}
        </p>
      ) : (
        <ul className="divide-y">
          {base.map((linha) => {
            const editando = editandoId === linha.id;
            return (
              <li
                key={linha.id}
                className={cn("flex items-center gap-2 px-4 py-2", !linha.incluir && "opacity-50")}
              >
                {editando ? (
                  <>
                    <input
                      value={editNome}
                      onChange={(e) => setEditNome(e.target.value)}
                      autoFocus
                      className={INPUT_CLS + " flex-1"}
                    />
                    <input
                      value={editValor}
                      onChange={(e) => setEditValor(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") salvarEdicao(linha);
                        if (e.key === "Escape") setEditandoId(null);
                      }}
                      className={INPUT_CLS + " w-32 text-right"}
                    />
                    <button
                      onClick={() => salvarEdicao(linha)}
                      disabled={isPending}
                      className={BTN_GHOST + " text-green-700"}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => setEditandoId(null)} className={BTN_GHOST}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <div
                        className={cn("truncate text-sm", !linha.incluir && "line-through")}
                        title={linha.fornecedor ?? undefined}
                      >
                        {linha.nome}
                      </div>
                      {linha.lancamentos > 0 && (
                        <div className="text-[11px] text-muted-foreground">
                          {linha.lancamentos} lançamento(s) em {year - 1}
                          {linha.grupoNome ? ` · ${linha.grupoNome}` : ""}
                        </div>
                      )}
                    </div>
                    <span className="shrink-0 text-sm tabular-nums">
                      {formatBRL(linha.valorAno)}
                    </span>
                    {isAdmin && (
                      <div className="flex shrink-0 items-center gap-0.5">
                        <select
                          value={linha.grupoId ?? ""}
                          onChange={(e) =>
                            run(
                              () =>
                                salvarLinhaBase(linha.id, {
                                  grupoId: e.target.value || null,
                                }),
                              "Grupo atualizado.",
                            )
                          }
                          disabled={isPending || grupos.length === 0}
                          title="Grupo desta despesa"
                          className="rounded-md border bg-background px-1.5 py-1 text-[11px] outline-none focus:ring-1 focus:ring-ring disabled:opacity-40"
                        >
                          <option value="">— grupo —</option>
                          {grupos.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => {
                            setEditandoId(linha.id);
                            setEditNome(linha.nome);
                            setEditValor(numberToInput(linha.valorAno));
                          }}
                          disabled={isPending}
                          className={BTN_GHOST}
                          title="Renomear ou corrigir o valor"
                        >
                          editar
                        </button>
                        <button
                          onClick={() =>
                            run(
                              () => salvarLinhaBase(linha.id, { incluir: !linha.incluir }),
                              linha.incluir ? "Linha desconsiderada." : "Linha reconsiderada.",
                            )
                          }
                          disabled={isPending}
                          className={BTN_GHOST}
                          title={
                            linha.incluir
                              ? "Desconsiderar: some da entrevista, mas fica registrada"
                              : "Voltar a considerar"
                          }
                        >
                          <EyeOff className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => run(() => removerLinhaBase(linha.id), "Linha excluída.")}
                          disabled={isPending}
                          className={BTN_GHOST + " hover:text-destructive"}
                          title="Excluir de vez"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {isAdmin && (
        <div className="flex items-center gap-2 border-t bg-muted/20 px-4 py-2.5">
          <input
            value={novoNome}
            onChange={(e) => setNovoNome(e.target.value)}
            placeholder="Acrescentar despesa à base"
            className={INPUT_CLS + " flex-1"}
          />
          <input
            value={novoValor}
            onChange={(e) => setNovoValor(e.target.value)}
            placeholder="Valor no ano"
            className={INPUT_CLS + " w-36 text-right"}
          />
          <button
            onClick={() => {
              const valor = parseBrNumber(novoValor);
              if (valor != null && Number.isNaN(valor)) {
                setFeedback({ ok: false, msg: "Valor inválido." });
                return;
              }
              run(
                () =>
                  adicionarLinhaBase(
                    companyId,
                    year,
                    categoryCode,
                    setorId,
                    novoNome,
                    valor ?? 0,
                  ),
                "Linha acrescentada.",
              );
              setNovoNome("");
              setNovoValor("");
            }}
            disabled={isPending || !novoNome.trim()}
            className={BTN_GHOST}
          >
            <Plus className="h-3.5 w-3.5" /> Acrescentar
          </button>
        </div>
      )}
    </section>
  );
}
