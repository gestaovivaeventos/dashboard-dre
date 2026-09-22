"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Lock,
  MessageSquarePlus,
  Pencil,
  RotateCcw,
  Unlock,
} from "lucide-react";

import {
  alterarItemPlanejamento,
  cancelarColaborador,
  cancelarItemPlanejamento,
  liberarItem,
  solicitarAjuste,
} from "@/lib/orcamento/actions/validacao";
import {
  getValidacao,
  type ValidacaoDados,
  type ValidacaoItem,
  type ValidacaoSetor,
} from "@/lib/orcamento/actions/validacao-dados";
import { metodoLabel } from "@/lib/orcamento/metodos";
import { cn } from "@/lib/utils";

const BRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** Diálogo aberto: qual item e qual decisão. */
type Acao = "cancelar" | "reativar" | "alterar" | "solicitar" | "liberar";
interface Dialogo {
  acao: Acao;
  setor: ValidacaoSetor;
  categoryCode: string;
  item: ValidacaoItem;
}

/**
 * Tela de validação da diretoria: setor → categoria → item, com o total sempre
 * à vista e as decisões inline.
 *
 * A pergunta que ela responde é "este orçamento está aprovado?", então o total
 * da empresa fica fixo no topo e cada decisão o move na hora — validar linha a
 * linha sem ver o efeito no total é como cortar no escuro.
 */
export function ValidacaoView({
  companyId,
  year,
  podeDecidir,
}: {
  companyId: string;
  year: number;
  /** Diretoria (ou admin) com o ciclo em validação. Fora disso, é só leitura. */
  podeDecidir: boolean;
}) {
  const [dados, setDados] = useState<ValidacaoDados | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [motivo, setMotivo] = useState("");
  const [permitir, setPermitir] = useState(false);
  const [novoValor, setNovoValor] = useState("");
  const [isPending, startTransition] = useTransition();

  async function recarregar() {
    setCarregando(true);
    const res = await getValidacao(companyId, year);
    setCarregando(false);
    if (res.error) {
      setErro(res.error);
      setDados(null);
      return;
    }
    setErro(null);
    setDados(res.dados ?? null);
  }

  useEffect(() => {
    void recarregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, year]);

  const delta = useMemo(() => {
    if (!dados?.propostoAno) return null;
    return dados.totalAno - dados.propostoAno;
  }, [dados]);

  function toggle(chave: string) {
    setAbertos((prev) => {
      const next = new Set(prev);
      if (next.has(chave)) next.delete(chave);
      else next.add(chave);
      return next;
    });
  }

  function abrir(acao: Acao, setor: ValidacaoSetor, categoryCode: string, item: ValidacaoItem) {
    setDialogo({ acao, setor, categoryCode, item });
    setMotivo("");
    setPermitir(false);
    setNovoValor("");
  }

  function confirmar() {
    if (!dialogo) return;
    const { acao, setor, categoryCode, item } = dialogo;
    setErro(null);
    startTransition(async () => {
      let res: { ok?: true; error?: string } = {};

      if (acao === "cancelar" || acao === "reativar") {
        const reativar = acao === "reativar";
        if (item.alvoTipo === "colaborador" && item.alvoId) {
          res = await cancelarColaborador(item.alvoId, motivo, permitir, reativar);
        } else if (item.alvoTipo === "planejamento_item" && item.indice != null) {
          res = await cancelarItemPlanejamento({
            companyId,
            year,
            categoryCode,
            setorId: setor.setorId,
            indice: item.indice,
            descricao: item.nome,
            motivo,
            permiteAlteracao: permitir,
            reativar,
          });
        }
      } else if (acao === "alterar") {
        const valor = Number(novoValor.replace(/\./g, "").replace(",", "."));
        if (!Number.isFinite(valor) || valor < 0) {
          setErro("Valor inválido.");
          return;
        }
        if (item.indice == null) {
          setErro("Este item não aceita alteração direta de valor.");
          return;
        }
        res = await alterarItemPlanejamento({
          companyId,
          year,
          categoryCode,
          setorId: setor.setorId,
          indice: item.indice,
          descricao: item.nome,
          valorMensal: valor,
          motivo,
          permiteAlteracao: permitir,
        });
      } else if (acao === "solicitar") {
        res = await solicitarAjuste({
          companyId,
          year,
          categoryCode,
          setorId: setor.setorId,
          metodo: item.metodo,
          alvoTipo: item.alvoTipo,
          alvoId: item.alvoId,
          alvoRotulo: item.nome,
          motivo,
        });
      } else if (acao === "liberar") {
        res = await liberarItem({
          companyId,
          year,
          alvoTipo: item.alvoTipo,
          alvoId: item.alvoId,
          categoryCode,
          setorId: setor.setorId,
          alvoRotulo: item.nome,
          motivo,
        });
      }

      if (res.error) {
        setErro(res.error);
        return;
      }
      setDialogo(null);
      await recarregar();
    });
  }

  if (carregando && !dados) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando o orçamento…
      </div>
    );
  }

  if (erro && !dados) {
    return (
      <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{erro}</div>
    );
  }

  if (!dados || dados.setores.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
        Nada orçado nesta empresa neste ano — não há o que validar.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Total sempre à vista: cada decisão o move na hora. */}
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border bg-muted/20 p-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Despesa orçada (soma dos itens desta tela)
          </p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums">{BRL(dados.totalAno)}</p>
        </div>
        {dados.propostoAno != null && (
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Proposto no envio
            </p>
            <p className="mt-0.5 text-sm tabular-nums">{BRL(dados.propostoAno)}</p>
            {delta != null && delta !== 0 && (
              <p
                className={cn(
                  "text-sm font-semibold tabular-nums",
                  delta < 0 ? "text-emerald-600" : "text-amber-600",
                )}
              >
                {delta < 0 ? "−" : "+"}
                {BRL(Math.abs(delta))}
              </p>
            )}
          </div>
        )}
      </div>

      {!podeDecidir && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-muted-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>
            Somente leitura: a validação acontece quando o orçamento é enviado à diretoria.
          </span>
        </div>
      )}

      {dados.pendencias.length > 0 && (
        <div className="space-y-1.5 rounded-md border border-violet-500/40 bg-violet-500/5 p-3">
          <p className="text-sm font-medium">
            {dados.pendencias.length} pendência(s) em aberto
          </p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {dados.pendencias.slice(0, 6).map((p) => (
              <li key={p.id}>
                <strong className="text-foreground">{p.alvoRotulo ?? "Item"}</strong> —{" "}
                {p.acao === "contestou" ? "pedido de liberação" : "ajuste solicitado"}
                {p.motivo ? `: ${p.motivo}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {erro && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</div>
      )}

      {dados.setores.map((setor) => (
        <section key={setor.setorId ?? "sem"} className="rounded-xl border">
          <header className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-2.5">
            <h3 className="font-semibold">{setor.setorNome}</h3>
            <span className="text-sm font-semibold tabular-nums">{BRL(setor.totalAno)}</span>
          </header>

          <div className="divide-y">
            {setor.categorias.map((cat) => {
              const chaveCat = `${setor.setorId ?? "sem"}:${cat.categoryCode}`;
              const aberta = abertos.has(chaveCat);
              return (
                <div key={chaveCat}>
                  <button
                    type="button"
                    onClick={() => toggle(chaveCat)}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/40"
                  >
                    {aberta ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {cat.categoryName}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {metodoLabel(cat.metodo)}
                    </span>
                    <span className="shrink-0 text-sm tabular-nums">{BRL(cat.totalAno)}</span>
                  </button>

                  {aberta && (
                    <ul className="divide-y border-t bg-background/50">
                      {cat.itens.map((item) => (
                        <li
                          key={item.chave}
                          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 pl-10"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={cn(
                                  "truncate text-sm",
                                  item.cancelado && "line-through opacity-60",
                                )}
                              >
                                {item.nome}
                              </span>
                              {item.travado && (
                                <span title="Alterado pela diretoria — travado para o gestor">
                                  <Lock className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                                </span>
                              )}
                            </div>
                            {item.detalhe && (
                              <p className="truncate text-xs text-muted-foreground">
                                {item.detalhe}
                              </p>
                            )}
                            {item.cancelado && item.canceladoMotivo && (
                              <p className="text-xs text-amber-700 dark:text-amber-500">
                                Cancelado: {item.canceladoMotivo}
                              </p>
                            )}
                          </div>

                          <span
                            className={cn(
                              "shrink-0 text-sm tabular-nums",
                              item.cancelado && "line-through opacity-60",
                            )}
                          >
                            {BRL(item.totalAno)}
                          </span>

                          {podeDecidir && (
                            <div className="flex shrink-0 gap-1">
                              {item.podeAlterarValor && !item.cancelado && (
                                <IconBtn
                                  title="Alterar valor"
                                  onClick={() => abrir("alterar", setor, cat.categoryCode, item)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </IconBtn>
                              )}
                              {item.podeCancelar &&
                                (item.cancelado ? (
                                  <IconBtn
                                    title="Reativar"
                                    onClick={() => abrir("reativar", setor, cat.categoryCode, item)}
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                  </IconBtn>
                                ) : (
                                  <IconBtn
                                    title="Cancelar"
                                    onClick={() => abrir("cancelar", setor, cat.categoryCode, item)}
                                  >
                                    <Ban className="h-3.5 w-3.5" />
                                  </IconBtn>
                                ))}
                              <IconBtn
                                title="Solicitar ajuste ao gestor"
                                onClick={() => abrir("solicitar", setor, cat.categoryCode, item)}
                              >
                                <MessageSquarePlus className="h-3.5 w-3.5" />
                              </IconBtn>
                              {item.travado && (
                                <IconBtn
                                  title="Liberar para o gestor ajustar"
                                  onClick={() => abrir("liberar", setor, cat.categoryCode, item)}
                                >
                                  <Unlock className="h-3.5 w-3.5" />
                                </IconBtn>
                              )}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <p className="text-xs text-muted-foreground">
        Em Despesas com pessoal, o valor mostrado é <strong>12 × o salário</strong> — a referência
        da decisão. O custo com encargos, férias e 13º aparece na Prévia do orçamento.
      </p>

      {/* Diálogo da decisão */}
      {dialogo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md space-y-3 rounded-xl border bg-background p-4 shadow-lg">
            <div>
              <p className="font-semibold">
                {dialogo.acao === "cancelar" && "Cancelar item"}
                {dialogo.acao === "reativar" && "Reativar item"}
                {dialogo.acao === "alterar" && "Alterar valor"}
                {dialogo.acao === "solicitar" && "Solicitar ajuste ao gestor"}
                {dialogo.acao === "liberar" && "Liberar para o gestor ajustar"}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {dialogo.item.nome} · {dialogo.setor.setorNome}
              </p>
            </div>

            {dialogo.acao === "alterar" && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Novo valor mensal</label>
                <input
                  value={novoValor}
                  onChange={(e) => setNovoValor(e.target.value)}
                  placeholder="0,00"
                  inputMode="decimal"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Motivo
                {dialogo.acao !== "reativar" && dialogo.acao !== "liberar" && (
                  <span className="text-destructive"> *</span>
                )}
              </label>
              <textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={3}
                placeholder="O gestor vai ler isto no retorno."
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* A trava é o padrão; este checkbox é a única forma de NÃO travar. */}
            {dialogo.acao !== "liberar" && dialogo.acao !== "solicitar" && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={permitir}
                  onChange={(e) => setPermitir(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <strong>Permitir que o gestor ajuste</strong> este item.
                  <span className="block text-xs text-muted-foreground">
                    Sem marcar, o item fica travado e ele terá de pedir liberação.
                  </span>
                </span>
              </label>
            )}

            {dialogo.acao === "solicitar" && (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                Solicitar não altera o orçamento nem trava o item — o gestor decide como atender.
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={confirmar}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Confirmar
              </button>
              <button
                type="button"
                onClick={() => setDialogo(null)}
                disabled={isPending}
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

function IconBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}
