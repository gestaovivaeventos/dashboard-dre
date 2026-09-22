"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  Ban,
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
  type ValidacaoCategoria,
  type ValidacaoDados,
  type ValidacaoItem,
  type ValidacaoSetor,
} from "@/lib/orcamento/actions/validacao-dados";
import { metodoLabel } from "@/lib/orcamento/metodos";
import { cn } from "@/lib/utils";

const BRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** Ações do painel. `alterar` e `solicitar` pedem um campo a mais. */
type Acao = "cancelar" | "reativar" | "alterar" | "solicitar" | "liberar";

/**
 * Tela de validação da diretoria.
 *
 * Três decisões de desenho, todas para o diretor decidir rápido:
 *
 *  1. **Filtro por setor.** Ele valida setor a setor com o responsável, não a
 *     empresa toda de uma vez.
 *  2. **Painel de ações por categoria, com seleção.** Antes cada item tinha
 *     quatro ícones minúsculos; agora ele marca os itens e age uma vez — cortar
 *     cinco contratações é um clique, não cinco.
 *  3. **Justificativa OPCIONAL.** Obrigá-la em toda decisão fazia digitar por
 *     item, e o que sai disso é texto de preenchimento. O texto continua
 *     obrigatório onde ELE É a ação: solicitar um ajuste ao gestor.
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
  const [setorFiltro, setSetorFiltro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [selecao, setSelecao] = useState<Set<string>>(new Set());
  const [comentario, setComentario] = useState("");
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

  const setoresVisiveis = useMemo<ValidacaoSetor[]>(() => {
    if (!dados) return [];
    return setorFiltro === null
      ? dados.setores
      : dados.setores.filter((s) => (s.setorId ?? "sem") === setorFiltro);
  }, [dados, setorFiltro]);

  const totalVisivel = useMemo(
    () => setoresVisiveis.reduce((a, s) => a + s.totalAno, 0),
    [setoresVisiveis],
  );

  const delta = useMemo(() => {
    if (!dados?.propostoAno || setorFiltro !== null) return null;
    return dados.totalAno - dados.propostoAno;
  }, [dados, setorFiltro]);

  function abrirCategoria(chave: string) {
    setAberta((atual) => (atual === chave ? null : chave));
    setSelecao(new Set());
    setComentario("");
    setPermitir(false);
    setNovoValor("");
  }

  function alternar(chave: string) {
    setSelecao((prev) => {
      const next = new Set(prev);
      if (next.has(chave)) next.delete(chave);
      else next.add(chave);
      return next;
    });
  }

  /** Executa a ação sobre os itens marcados (ou a categoria, em "solicitar"). */
  function executar(
    acao: Acao,
    setor: ValidacaoSetor,
    cat: ValidacaoCategoria,
    itens: ValidacaoItem[],
  ) {
    setErro(null);

    if (acao === "solicitar" && !comentario.trim()) {
      setErro("Escreva o que você está pedindo ao gestor.");
      return;
    }
    if (acao === "alterar") {
      const v = Number(novoValor.replace(/\./g, "").replace(",", "."));
      if (!Number.isFinite(v) || v < 0) {
        setErro("Informe o novo valor mensal.");
        return;
      }
    }

    startTransition(async () => {
      const falhas: string[] = [];

      // "Solicitar" sem item marcado é um pedido sobre a CATEGORIA — é o caso
      // comum em média e valor fixo, onde a diretoria não edita.
      const alvos = acao === "solicitar" && itens.length === 0 ? [null] : itens;

      for (const item of alvos) {
        let res: { ok?: true; error?: string } = {};

        if (acao === "solicitar") {
          res = await solicitarAjuste({
            companyId,
            year,
            categoryCode: cat.categoryCode,
            setorId: setor.setorId,
            metodo: item?.metodo ?? cat.metodo,
            alvoTipo: item?.alvoTipo ?? "categoria_setor",
            alvoId: item?.alvoId ?? null,
            alvoRotulo: item?.nome ?? cat.categoryName,
            motivo: comentario,
          });
        } else if (!item) {
          continue;
        } else if (acao === "cancelar" || acao === "reativar") {
          const reativar = acao === "reativar";
          if (item.alvoTipo === "colaborador" && item.alvoId) {
            res = await cancelarColaborador(item.alvoId, comentario, permitir, reativar);
          } else if (item.alvoTipo === "planejamento_item" && item.indice != null) {
            res = await cancelarItemPlanejamento({
              companyId,
              year,
              categoryCode: cat.categoryCode,
              setorId: setor.setorId,
              indice: item.indice,
              descricao: item.nome,
              motivo: comentario,
              permiteAlteracao: permitir,
              reativar,
            });
          }
        } else if (acao === "alterar" && item.indice != null) {
          res = await alterarItemPlanejamento({
            companyId,
            year,
            categoryCode: cat.categoryCode,
            setorId: setor.setorId,
            indice: item.indice,
            descricao: item.nome,
            valorMensal: Number(novoValor.replace(/\./g, "").replace(",", ".")),
            motivo: comentario,
            permiteAlteracao: permitir,
          });
        } else if (acao === "liberar") {
          res = await liberarItem({
            companyId,
            year,
            alvoTipo: item.alvoTipo,
            alvoId: item.alvoId,
            categoryCode: cat.categoryCode,
            setorId: setor.setorId,
            alvoRotulo: item.nome,
            motivo: comentario,
          });
        }

        if (res.error) falhas.push(`${item?.nome ?? cat.categoryName}: ${res.error}`);
      }

      if (falhas.length > 0) setErro(falhas.join(" · "));
      setSelecao(new Set());
      setComentario("");
      setPermitir(false);
      setNovoValor("");
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
    return <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{erro}</div>;
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
      {/* Total do recorte atual. Filtrando por setor, o número acompanha — é o
          que o diretor discute com aquele responsável. */}
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border bg-muted/20 p-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {setorFiltro === null ? "Despesa orçada da empresa" : "Despesa orçada do setor"}
          </p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums">{BRL(totalVisivel)}</p>
        </div>
        {dados.propostoAno != null && setorFiltro === null && (
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

      {/* Filtro por setor: o diretor valida com um responsável por vez. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip ativo={setorFiltro === null} onClick={() => setSetorFiltro(null)}>
          Todos os setores
        </Chip>
        {dados.setores.map((s) => (
          <Chip
            key={s.setorId ?? "sem"}
            ativo={setorFiltro === (s.setorId ?? "sem")}
            onClick={() => {
              setSetorFiltro(s.setorId ?? "sem");
              setAberta(null);
            }}
          >
            {s.setorNome}
            <span className="ml-1.5 opacity-60 tabular-nums">{BRL(s.totalAno)}</span>
          </Chip>
        ))}
      </div>

      {!podeDecidir && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-muted-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>Somente leitura: a validação acontece quando o orçamento é enviado à diretoria.</span>
        </div>
      )}

      {dados.pendencias.length > 0 && (
        <div className="space-y-1 rounded-md border border-violet-500/40 bg-violet-500/5 p-3">
          <p className="text-sm font-medium">{dados.pendencias.length} pendência(s) em aberto</p>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
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

      {setoresVisiveis.map((setor) => (
        <section key={setor.setorId ?? "sem"} className="rounded-xl border">
          <header className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-2.5">
            <h3 className="font-semibold">{setor.setorNome}</h3>
            <span className="text-sm font-semibold tabular-nums">{BRL(setor.totalAno)}</span>
          </header>

          <div className="divide-y">
            {setor.categorias.map((cat) => {
              const chave = `${setor.setorId ?? "sem"}:${cat.categoryCode}`;
              const estaAberta = aberta === chave;
              const marcados = cat.itens.filter((i) => selecao.has(i.chave));

              return (
                <div key={chave}>
                  <button
                    type="button"
                    onClick={() => abrirCategoria(chave)}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/40"
                  >
                    {estaAberta ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {cat.categoryName}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {cat.itens.length} item(ns) · {metodoLabel(cat.metodo)}
                    </span>
                    <span className="shrink-0 text-sm tabular-nums">{BRL(cat.totalAno)}</span>
                  </button>

                  {estaAberta && (
                    <div className="border-t bg-background/50">
                      {podeDecidir && (
                        <PainelAcoes
                          cat={cat}
                          marcados={marcados}
                          comentario={comentario}
                          setComentario={setComentario}
                          permitir={permitir}
                          setPermitir={setPermitir}
                          novoValor={novoValor}
                          setNovoValor={setNovoValor}
                          ocupado={isPending}
                          onAcao={(acao) => executar(acao, setor, cat, marcados)}
                        />
                      )}

                      <ul className="divide-y">
                        {cat.itens.map((item) => {
                          const marcado = selecao.has(item.chave);
                          return (
                            <li
                              key={item.chave}
                              className={cn(
                                "flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 pl-10",
                                marcado && "bg-primary/5",
                              )}
                            >
                              {podeDecidir && (
                                <input
                                  type="checkbox"
                                  checked={marcado}
                                  onChange={() => alternar(item.chave)}
                                  className="h-4 w-4 shrink-0"
                                  aria-label={`Selecionar ${item.nome}`}
                                />
                              )}
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
                            </li>
                          );
                        })}
                      </ul>
                    </div>
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
    </div>
  );
}

/**
 * O painel de ações da categoria aberta.
 *
 * Age sobre os itens MARCADOS. "Solicitar ajuste" é a exceção: sem nada marcado
 * ele vale para a categoria inteira — é o caminho da diretoria em média e valor
 * fixo, onde ela não edita, só pede.
 */
function PainelAcoes({
  cat,
  marcados,
  comentario,
  setComentario,
  permitir,
  setPermitir,
  novoValor,
  setNovoValor,
  ocupado,
  onAcao,
}: {
  cat: ValidacaoCategoria;
  marcados: ValidacaoItem[];
  comentario: string;
  setComentario: (v: string) => void;
  permitir: boolean;
  setPermitir: (v: boolean) => void;
  novoValor: string;
  setNovoValor: (v: string) => void;
  ocupado: boolean;
  onAcao: (acao: Acao) => void;
}) {
  const n = marcados.length;
  const podeCancelar = n > 0 && marcados.every((i) => i.podeCancelar && !i.cancelado);
  const podeReativar = n > 0 && marcados.every((i) => i.cancelado);
  const podeAlterar = n === 1 && marcados[0].podeAlterarValor && !marcados[0].cancelado;
  const podeLiberar = n > 0 && marcados.every((i) => i.travado);
  const soPede = cat.itens.every((i) => !i.podeCancelar && !i.podeAlterarValor);

  return (
    <div className="space-y-2 border-b bg-muted/30 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {n === 0
            ? soPede
              ? "Esta categoria é montada pelo administrador — aqui a diretoria solicita o ajuste."
              : "Marque os itens para agir sobre eles."
            : `${n} item(ns) marcado(s)`}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Botao icone={Ban} ativo={podeCancelar} ocupado={ocupado} onClick={() => onAcao("cancelar")}>
          Cancelar
        </Botao>
        <Botao
          icone={RotateCcw}
          ativo={podeReativar}
          ocupado={ocupado}
          onClick={() => onAcao("reativar")}
        >
          Reativar
        </Botao>
        <Botao icone={Pencil} ativo={podeAlterar} ocupado={ocupado} onClick={() => onAcao("alterar")}>
          Alterar valor
        </Botao>
        <Botao
          icone={MessageSquarePlus}
          ativo
          ocupado={ocupado}
          onClick={() => onAcao("solicitar")}
        >
          {n === 0 ? "Solicitar ajuste na categoria" : "Solicitar ajuste"}
        </Botao>
        <Botao icone={Unlock} ativo={podeLiberar} ocupado={ocupado} onClick={() => onAcao("liberar")}>
          Liberar
        </Botao>
      </div>

      {podeAlterar && (
        <input
          value={novoValor}
          onChange={(e) => setNovoValor(e.target.value)}
          placeholder="Novo valor mensal (ex.: 1.500,00)"
          inputMode="decimal"
          className="w-56 rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      )}

      {/* Comentário OPCIONAL — só quando a diretoria quiser dizer algo. Vira
          obrigatório apenas em "Solicitar ajuste", onde o texto é o pedido. */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          placeholder="Comentário (opcional) — o gestor lê isto no retorno"
          className="min-w-[16rem] flex-1 rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={permitir}
            onChange={(e) => setPermitir(e.target.checked)}
          />
          Permitir que o gestor ajuste
        </label>
      </div>
    </div>
  );
}

function Botao({
  icone: Icone,
  ativo,
  ocupado,
  onClick,
  children,
}: {
  icone: typeof Ban;
  ativo: boolean;
  ocupado: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={!ativo || ocupado}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
    >
      {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icone className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

function Chip({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        ativo ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
