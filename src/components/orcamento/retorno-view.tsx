"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Ban,
  Check,
  CheckCheck,
  ExternalLink,
  Loader2,
  Lock,
  MessageSquare,
  Pencil,
  RotateCcw,
  Unlock,
} from "lucide-react";

import { getRetorno, marcarCiente, type RetornoDados, type RetornoEntrada } from "@/lib/orcamento/actions/retorno";
import { pedirLiberacao, responderSolicitacao } from "@/lib/orcamento/actions/validacao";
import { getTrilha } from "@/lib/orcamento/actions/trilha";
import { ACAO_LABEL, type TrilhaEntrada } from "@/lib/orcamento/trilha";
import { cn } from "@/lib/utils";

const BRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const ICONE: Partial<Record<string, typeof Ban>> = {
  cancelou: Ban,
  reativou: RotateCcw,
  alterou: Pencil,
  solicitou: MessageSquare,
  liberou: Unlock,
};

/**
 * Retorno da diretoria, na visão de quem montou o orçamento.
 *
 * Duas abas porque são duas perguntas diferentes: "o que mudou e o que depende
 * de mim" (Decisões) e "o que aconteceu com este orçamento" (Histórico). A
 * primeira esvazia conforme ele responde; a segunda nunca esvazia.
 */
export function RetornoView({ companyId, year }: { companyId: string; year: number }) {
  const [aba, setAba] = useState<"decisoes" | "historico">("decisoes");
  const [dados, setDados] = useState<RetornoDados | null>(null);
  const [historico, setHistorico] = useState<TrilhaEntrada[] | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [pedido, setPedido] = useState<RetornoEntrada | null>(null);
  const [motivo, setMotivo] = useState("");
  const [isPending, startTransition] = useTransition();

  async function recarregar() {
    setCarregando(true);
    const res = await getRetorno(companyId, year);
    setCarregando(false);
    if (res.error) {
      setErro(res.error);
      return;
    }
    setErro(null);
    setDados(res.dados ?? null);
  }

  useEffect(() => {
    void recarregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, year]);

  useEffect(() => {
    if (aba !== "historico" || historico) return;
    void getTrilha(companyId, year).then((res) => setHistorico(res.itens ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aba, companyId, year]);

  const placar = useMemo(() => {
    if (!dados?.propostoAno) return null;
    const agora = dados.finalAno ?? null;
    if (agora == null) return { de: dados.propostoAno, para: null, delta: null, pct: null };
    const delta = agora - dados.propostoAno;
    return {
      de: dados.propostoAno,
      para: agora,
      delta,
      pct: dados.propostoAno === 0 ? null : (delta / dados.propostoAno) * 100,
    };
  }, [dados]);

  function agir(fn: () => Promise<{ ok?: true; error?: string }>) {
    setErro(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) {
        setErro(res.error);
        return;
      }
      setPedido(null);
      setMotivo("");
      setHistorico(null); // o histórico ganhou uma linha
      await recarregar();
    });
  }

  if (carregando && !dados) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando o retorno…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Placar: o movimento que a diretoria produziu. É a primeira coisa que o
          gestor quer saber, e o que dá sentido às linhas abaixo. */}
      {placar && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-muted/20 p-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              O que você montou
            </p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums">{BRL(placar.de)}</p>
          </div>
          {placar.para != null ? (
            <>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Aprovado
                </p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums">{BRL(placar.para)}</p>
              </div>
              {placar.delta != null && placar.delta !== 0 && (
                <div
                  className={cn(
                    "rounded-md px-2.5 py-1 text-sm font-semibold tabular-nums",
                    placar.delta < 0
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "bg-amber-500/10 text-amber-700 dark:text-amber-400",
                  )}
                >
                  {placar.delta < 0 ? "−" : "+"}
                  {BRL(Math.abs(placar.delta))}
                  {placar.pct != null && ` (${placar.pct.toFixed(1).replace(".", ",")}%)`}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              A validação ainda não foi concluída — o número aprovado aparece aqui quando fechar.
            </p>
          )}
        </div>
      )}

      <div className="flex gap-1 border-b">
        {(
          [
            ["decisoes", `Decisões da diretoria${dados?.entradas.length ? ` (${dados.entradas.length})` : ""}`],
            ["historico", "Histórico do orçamento"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setAba(k)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              aba === k
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {erro && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</div>
      )}

      {aba === "decisoes" &&
        (dados && dados.entradas.length > 0 ? (
          <div className="space-y-2">
            {(dados.pendentes > 0 || dados.travados > 0) && (
              <p className="text-sm text-muted-foreground">
                {dados.pendentes > 0 && (
                  <>
                    <strong className="text-foreground">{dados.pendentes}</strong> aguardando sua
                    resposta.{" "}
                  </>
                )}
                {dados.travados > 0 && (
                  <>
                    <strong className="text-foreground">{dados.travados}</strong> item(ns) travado(s)
                    — peça liberação para ajustar.
                  </>
                )}
              </p>
            )}

            <ul className="space-y-2">
              {dados.entradas.map((e) => {
                const Icone = ICONE[e.acao] ?? Pencil;
                return (
                  <li key={e.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted">
                        <Icone className="h-4 w-4 text-muted-foreground" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">
                          <strong>{e.alvoRotulo ?? "Item"}</strong>{" "}
                          <span className="text-muted-foreground">
                            — {ACAO_LABEL[e.acao] ?? e.acao}
                          </span>
                          {e.setorNome && (
                            <span className="text-muted-foreground"> · {e.setorNome}</span>
                          )}
                        </p>

                        <Movimento antes={e.antes} depois={e.depois} />

                        {e.motivo && (
                          <p className="mt-1 rounded-md bg-muted/50 px-2 py-1 text-sm">
                            “{e.motivo}”
                            {e.autorNome && (
                              <span className="text-muted-foreground"> — {e.autorNome}</span>
                            )}
                          </p>
                        )}

                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          {e.travadoAgora && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                              <Lock className="h-3 w-3" /> Travado
                            </span>
                          )}
                          {e.resolucao === "pendente" && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-400">
                              Aguardando você
                            </span>
                          )}
                          {e.resolucao === "atendida" && (
                            <span className="text-xs text-emerald-700 dark:text-emerald-400">
                              Atendida
                            </span>
                          )}
                          {e.ciente && !e.resolucao && (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <CheckCheck className="h-3.5 w-3.5" /> Ciente
                            </span>
                          )}
                          {e.href && (
                            <Link
                              href={e.href}
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              Abrir a tela <ExternalLink className="h-3 w-3" />
                            </Link>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        {e.resolucao === "pendente" ? (
                          <>
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => agir(() => responderSolicitacao(e.id, "atendida"))}
                              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                            >
                              <Check className="h-3.5 w-3.5" /> Atendida
                            </button>
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => setPedido(e)}
                              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                            >
                              <MessageSquare className="h-3.5 w-3.5" /> Contestar
                            </button>
                          </>
                        ) : (
                          <>
                            {!e.ciente && (
                              <button
                                type="button"
                                disabled={isPending}
                                onClick={() => agir(() => marcarCiente(e.id))}
                                className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                              >
                                <CheckCheck className="h-3.5 w-3.5" /> Ciente
                              </button>
                            )}
                            {e.travadoAgora && (
                              <button
                                type="button"
                                disabled={isPending}
                                onClick={() => setPedido(e)}
                                className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                              >
                                <Unlock className="h-3.5 w-3.5" /> Pedir liberação
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
            A diretoria ainda não registrou decisões nos seus setores.
          </div>
        ))}

      {aba === "historico" &&
        (historico == null ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando o histórico…
          </div>
        ) : historico.length === 0 ? (
          <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
            Nenhum registro ainda.
          </div>
        ) : (
          <ol className="space-y-1.5">
            {historico.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="w-32 shrink-0 tabular-nums text-xs text-muted-foreground">
                  {new Date(h.createdAt).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className="min-w-0 flex-1">
                  <strong>{h.autorNome ?? "Alguém"}</strong>{" "}
                  <span className="text-muted-foreground">{ACAO_LABEL[h.acao] ?? h.acao}</span>
                  {h.alvoRotulo && <> {h.alvoRotulo}</>}
                  {h.setorNome && <span className="text-muted-foreground"> · {h.setorNome}</span>}
                  {h.motivo && (
                    <span className="text-muted-foreground"> — “{h.motivo}”</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        ))}

      {/* Pedido de liberação / contestação */}
      {pedido && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md space-y-3 rounded-xl border bg-background p-4 shadow-lg">
            <div>
              <p className="font-semibold">
                {pedido.resolucao === "pendente" ? "Contestar a solicitação" : "Pedir liberação"}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">{pedido.alvoRotulo}</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Justificativa <span className="text-destructive">*</span>
              </label>
              <textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={3}
                placeholder="A diretoria vai ler isto para decidir."
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={isPending || !motivo.trim()}
                onClick={() =>
                  agir(() =>
                    pedido.resolucao === "pendente"
                      ? responderSolicitacao(pedido.id, "contestada", motivo)
                      : pedirLiberacao({
                          companyId,
                          year,
                          alvoTipo: pedido.alvoTipo,
                          alvoId: pedido.alvoId,
                          categoryCode: pedido.categoryCode,
                          setorId: pedido.setorId,
                          alvoRotulo: pedido.alvoRotulo ?? "Item",
                          motivo,
                        }),
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Enviar
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setPedido(null);
                  setMotivo("");
                }}
                className="rounded-md border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * O "de → para" de uma decisão. Mostra só os campos que a trilha registrou como
 * mudados (o diff já veio filtrado), e formata valor em reais quando o campo é
 * de dinheiro — "3000 → 2500" não diz de que ordem é o número.
 */
function Movimento({
  antes,
  depois,
}: {
  antes: Record<string, unknown> | null;
  depois: Record<string, unknown> | null;
}) {
  const campos = Object.keys(depois ?? {});
  if (campos.length === 0) return null;

  const ehDinheiro = (k: string) =>
    /valor|salario|media|base|mensal/i.test(k);
  const fmt = (k: string, v: unknown) => {
    if (v == null || v === "") return "vazio";
    if (typeof v === "boolean") return v ? "sim" : "não";
    const n = Number(v);
    if (ehDinheiro(k) && Number.isFinite(n)) return BRL(n);
    return String(v);
  };

  return (
    <p className="mt-0.5 text-xs text-muted-foreground">
      {campos.map((k, i) => (
        <span key={k}>
          {i > 0 && " · "}
          {ROTULO_CAMPO[k] ?? k}: <span className="line-through">{fmt(k, antes?.[k])}</span>
          {" → "}
          <strong className="text-foreground">{fmt(k, depois?.[k])}</strong>
        </span>
      ))}
    </p>
  );
}

const ROTULO_CAMPO: Record<string, string> = {
  salario_atual: "salário",
  cargo_atual: "cargo",
  valorMensal: "valor mensal",
  media_valor: "média",
  valor_base: "valor base",
  indice_key: "índice",
  mes_reajuste: "mês de reajuste",
  cancelado_em: "cancelado",
  cancelado: "cancelado",
  setor_id: "setor",
  descricao: "descrição",
};
