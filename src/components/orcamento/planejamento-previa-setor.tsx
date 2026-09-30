"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  MessageSquare,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";

import type {
  PreviaSetorItem,
  PreviaSetorResumo,
} from "@/lib/orcamento/actions/planejamento-categoria";
import { decidirItem, limparDecisao } from "@/lib/orcamento/actions/validacao-diretoria";
import {
  aplicarDecisao,
  type DecisaoAplicada,
} from "@/lib/orcamento/previa-setor-decisao";
import { ESTADO_LABEL, type ValidacaoEstado } from "@/lib/orcamento/validacao-diretoria";
import {
  contarPorMetodo,
  ROTULO_POR_METODO,
  sufixo,
  type ContagemRotulo,
} from "@/lib/orcamento/previa-setor-contagem";
import type { OrcamentoMetodo } from "@/lib/orcamento/metodos";
import { formatBRL } from "@/lib/orcamento/format";
import { textoParcelasDeMeses } from "@/lib/orcamento/parcelas";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Prévia do SETOR — a tela em que o orçamento é lido e, pela diretoria,
 * DECIDIDO.
 *
 * Duas leituras no mesmo lugar, de propósito. Para o gestor é como o orçamento
 * dele está ficando, atualizada a cada despesa confirmada. Para o diretor é a
 * fila de verificação: ele percorre as MESMAS linhas que o gestor montou, em
 * vez de uma tela consolidada à parte — uma dessas existiu no modelo antigo e
 * foi removida por duplicar a Prévia.
 *
 * Mostra TODAS as categorias orçadas do setor (qualquer método), não só a que
 * está aberta: o gestor precisa ver o conjunto para decidir a próxima, e o
 * diretor decide o setor inteiro de uma sentada.
 *
 * O subnível é o GRUPO, em ordem alfabética, com "Sem grupo" ao fim — ver
 * src/lib/orcamento/grupos.ts, que é quem ordena.
 */
export function PlanejamentoPreviaSetor({
  resumo: resumoDoServidor,
  carregando,
  setorNome,
  year,
  companyId,
  onDecidiu,
  metodoContagem,
}: {
  resumo: PreviaSetorResumo | null;
  carregando: boolean;
  setorNome: string;
  year: number;
  companyId: string;
  /** Recarrega a prévia depois de uma decisão. */
  onDecidiu?: () => void;
  /**
   * Método da TELA que abriu este painel. Recorta a faixa de números — a
   * LISTA continua sendo o setor inteiro, de propósito.
   *
   * Sem isso a faixa somava os quatro métodos e era lida como "o que falta
   * nesta tela": no Pessoal ela dizia "10 aprovadas" quando 3 eram
   * colaboradores e 7 eram despesas do Planejamento.
   */
  metodoContagem?: OrcamentoMetodo;
}) {
  // CÓPIA LOCAL do resumo, para a decisão aparecer no clique.
  //
  // O servidor continua sendo a verdade — `onDecidiu` recarrega e o valor de
  // lá sobrescreve este. Mas esperar o round-trip fazia a tela parecer travada
  // no gesto mais repetido da validação, e o diretor clicava de novo achando
  // que não tinha pegado.
  const [resumo, setResumo] = useState(resumoDoServidor);
  useEffect(() => {
    setResumo(resumoDoServidor);
  }, [resumoDoServidor]);

  /** Antecipa o efeito da decisão na tela; o refetch confirma. */
  const antecipar = (d: DecisaoAplicada) =>
    setResumo((atual) => (atual ? aplicarDecisao(atual, d) : atual));

  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [revisando, setRevisando] = useState<PreviaSetorItem | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  function alternar(chave: string) {
    setAbertas((prev) => {
      const próxima = new Set(prev);
      if (próxima.has(chave)) próxima.delete(chave);
      else próxima.add(chave);
      return próxima;
    });
  }

  const podeValidar = resumo?.podeValidar === true;

  // Deriva das CATEGORIAS, que é a mesma estrutura que `aplicarDecisao`
  // mantém — assim o número se move no clique junto com os totais, sem um
  // segundo caminho para divergir. Sem recorte, cai no setor inteiro (o que
  // `resumo.contagem` já trazia).
  const contagem = metodoContagem
    ? contarPorMetodo(resumo?.categorias ?? [], metodoContagem)
    : (resumo?.contagem ?? { pendentes: 0, aprovados: 0, reprovados: 0, revisar: 0, total: 0 });
  const rotulo = metodoContagem ? ROTULO_POR_METODO[metodoContagem] : undefined;

  function decidir(item: PreviaSetorItem, status: "aprovado" | "reprovado", comentario?: string) {
    if (!item.alvoTipo || !item.alvoId) return;
    setErro(null);
    antecipar({
      alvoTipo: item.alvoTipo,
      alvoId: item.alvoId,
      estado: status,
      comentario: comentario ?? null,
    });
    iniciar(async () => {
      const res = await decidirItem({
        companyId,
        year,
        alvoTipo: item.alvoTipo!,
        alvoId: item.alvoId!,
        setorId: item.setorId,
        alvoRotulo: item.nome,
        status,
        comentario,
      });
      // Recusa: recarrega para desfazer o que foi antecipado — a tela não pode
      // ficar mostrando uma decisão que o servidor não gravou.
      if (res.error) setErro(res.error);
      onDecidiu?.();
    });
  }

  function pedirRevisao(item: PreviaSetorItem, comentario: string) {
    if (!item.alvoTipo || !item.alvoId) return;
    setErro(null);
    antecipar({
      alvoTipo: item.alvoTipo,
      alvoId: item.alvoId,
      estado: "revisar",
      comentario,
    });
    setRevisando(null);
    iniciar(async () => {
      const res = await decidirItem({
        companyId,
        year,
        alvoTipo: item.alvoTipo!,
        alvoId: item.alvoId!,
        setorId: item.setorId,
        alvoRotulo: item.nome,
        status: "revisar",
        comentario,
      });
      if (res.error) setErro(res.error);
      onDecidiu?.();
    });
  }

  function desfazer(item: PreviaSetorItem) {
    if (!item.alvoTipo || !item.alvoId) return;
    setErro(null);
    antecipar({
      alvoTipo: item.alvoTipo,
      alvoId: item.alvoId,
      estado: "pendente",
      comentario: null,
    });
    iniciar(async () => {
      const res = await limparDecisao({
        companyId,
        year,
        alvoTipo: item.alvoTipo!,
        alvoId: item.alvoId!,
      });
      if (res.error) setErro(res.error);
      onDecidiu?.();
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
        <div className="flex items-baseline gap-6">
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Orçado</div>
            <div className="text-lg font-semibold tabular-nums">
              {carregando && !resumo ? "—" : formatBRL(resumo?.total ?? 0)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Aprovado</div>
            <div className="text-lg font-semibold tabular-nums text-emerald-600">
              {carregando && !resumo ? "—" : formatBRL(resumo?.totalAprovado ?? 0)}
            </div>
          </div>
        </div>
      </header>

      {/* A folha é quase sempre a maior linha do orçamento: se ela não entrou,
          o total abaixo está menor e a pessoa precisa saber POR QUÊ. */}
      {resumo?.pessoalIndisponivel && (
        <p className="flex items-start gap-1.5 border-b border-amber-500/40 bg-amber-500/5 px-4 py-2.5 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
          <span>
            As <strong className="text-foreground">despesas com pessoal</strong> não entraram
            neste total: {resumo.pessoalIndisponivel}
          </span>
        </p>
      )}

      {resumo && contagem.total > 0 && (
        <FaixaContagem contagem={contagem} rotulo={rotulo} podeValidar={podeValidar} />
      )}

      {erro && (
        <p className="border-b bg-destructive/5 px-4 py-2 text-xs text-destructive">{erro}</p>
      )}

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
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-medium tabular-nums">
                      {formatBRL(c.total)}
                    </span>
                    {/* Só quando os dois números divergem: repetir o mesmo
                        valor em verde embaixo vira ruído em toda linha. */}
                    {c.totalAprovado !== c.total && (
                      <span className="block text-[11px] tabular-nums text-emerald-600">
                        {formatBRL(c.totalAprovado)} aprovado
                      </span>
                    )}
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
                            <LinhaItem
                              key={`${i.alvoTipo ?? "x"}|${i.alvoId ?? idx}`}
                              item={i}
                              podeValidar={podeValidar}
                              salvando={salvando}
                              onAprovar={() => decidir(i, "aprovado")}
                              onReprovar={() => decidir(i, "reprovado")}
                              onRevisar={() => setRevisando(i)}
                              onDesfazer={() => desfazer(i)}
                            />
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

      <DialogRevisao
        item={revisando}
        salvando={salvando}
        onFechar={() => setRevisando(null)}
        onConfirmar={pedirRevisao}
      />
    </section>
  );
}

// ─── Faixa de contagem ───────────────────────────────────────────────────────

/**
 * O que falta, em números. O diretor lê "quantas tenho de verificar"; o gestor
 * lê "quantas voltaram para mim, quantas passaram e quantas caíram". É a mesma
 * contagem dos cards dos métodos, aqui recortada no setor.
 *
 * Com `rotulo`, o número é só do método da tela e o texto DIZ isso ("6
 * colaboradores a verificar"). O substantivo não é enfeite: a lista abaixo
 * continua sendo o setor inteiro, então um número menor sem dizer do que ele
 * fala é exatamente o tipo de número que leva à conclusão errada.
 */
function FaixaContagem({
  contagem,
  rotulo,
  podeValidar,
}: {
  contagem: { pendentes: number; aprovados: number; reprovados: number; revisar: number };
  rotulo?: ContagemRotulo;
  podeValidar: boolean;
}) {
  const partes: { texto: string; classe: string }[] = [];
  const nome = rotulo ? ` ${rotulo.plural}` : "";
  const g = sufixo(rotulo);
  if (contagem.pendentes > 0) {
    partes.push({
      texto: podeValidar
        ? `${contagem.pendentes}${nome} a verificar`
        : `${contagem.pendentes}${nome} aguardando o diretor`,
      classe: "text-amber-700",
    });
  }
  if (contagem.revisar > 0) {
    partes.push({ texto: `${contagem.revisar} a revisar`, classe: "text-sky-700" });
  }
  if (contagem.aprovados > 0) {
    partes.push({ texto: `${contagem.aprovados} aprovad${g}`, classe: "text-emerald-600" });
  }
  if (contagem.reprovados > 0) {
    partes.push({ texto: `${contagem.reprovados} reprovad${g}`, classe: "text-destructive" });
  }
  if (partes.length === 0) return null;

  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-[11px]">
      {partes.map((p) => (
        <span key={p.texto} className={cn("font-medium", p.classe)}>
          {p.texto}
        </span>
      ))}
    </p>
  );
}

// ─── Linha da despesa ────────────────────────────────────────────────────────

const PONTO: Record<ValidacaoEstado, string> = {
  pendente: "bg-muted-foreground/30",
  aprovado: "bg-emerald-500",
  reprovado: "bg-destructive",
  revisar: "bg-sky-500",
};

function LinhaItem({
  item,
  podeValidar,
  salvando,
  onAprovar,
  onReprovar,
  onRevisar,
  onDesfazer,
}: {
  item: PreviaSetorItem;
  podeValidar: boolean;
  salvando: boolean;
  onAprovar: () => void;
  onReprovar: () => void;
  onRevisar: () => void;
  onDesfazer: () => void;
}) {
  // Item sem identidade não recebe botão: gravar uma decisão num alvo
  // inventado criaria uma trava que ninguém conseguiria desfazer pela tela.
  const decidivel = podeValidar && Boolean(item.alvoTipo && item.alvoId);
  const decidido = item.estado !== "pendente";
  // "12 parcelas · jan–dez". O valor do ano não distingue um contrato anual de
  // doze mensalidades, nem mostra que a pessoa entra em maio.
  const parcelas = textoParcelasDeMeses(item.meses);

  return (
    <li className="group flex items-start justify-between gap-2 py-0.5 text-[11px] text-muted-foreground">
      <span className="flex min-w-0 flex-1 items-start gap-1.5">
        <span
          className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", PONTO[item.estado])}
          title={ESTADO_LABEL[item.estado]}
        />
        <span className="min-w-0">
          <span
            className={cn(
              "block truncate",
              item.estado === "reprovado" && "line-through opacity-70",
            )}
            title={item.detalhe ?? undefined}
          >
            {item.nome}
          </span>
          {item.comentario && (
            <span className="mt-0.5 block text-sky-700">
              <MessageSquare className="mr-1 inline h-3 w-3 align-[-2px]" />
              {item.comentario}
            </span>
          )}
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-1">
        {/* Antes do valor, e não embaixo do nome: é leitura DO NÚMERO — "R$ 665,00
            em 7 parcelas" — e fica na mesma varredura vertical de quem confere
            a coluna de valores. */}
        {parcelas && (
          <span className="mr-1 text-[10px] text-muted-foreground/70">{parcelas}</span>
        )}
        <span className="tabular-nums">{formatBRL(item.total)}</span>
        {decidivel && (
          <span className="flex items-center gap-0.5">
            <BotaoDecisao
              titulo="Aprovar"
              ativo={item.estado === "aprovado"}
              classeAtiva="bg-emerald-500 text-white"
              classeHover="hover:bg-emerald-500/15 hover:text-emerald-700"
              disabled={salvando}
              onClick={onAprovar}
            >
              <Check className="h-3 w-3" />
            </BotaoDecisao>
            <BotaoDecisao
              titulo="Reprovar"
              ativo={item.estado === "reprovado"}
              classeAtiva="bg-destructive text-white"
              classeHover="hover:bg-destructive/15 hover:text-destructive"
              disabled={salvando}
              onClick={onReprovar}
            >
              <X className="h-3 w-3" />
            </BotaoDecisao>
            <BotaoDecisao
              titulo="Pedir revisão"
              ativo={item.estado === "revisar"}
              classeAtiva="bg-sky-500 text-white"
              classeHover="hover:bg-sky-500/15 hover:text-sky-700"
              disabled={salvando}
              onClick={onRevisar}
            >
              <MessageSquare className="h-3 w-3" />
            </BotaoDecisao>
            {decidido && (
              <BotaoDecisao
                titulo="Desfazer a decisão"
                ativo={false}
                classeAtiva=""
                classeHover="hover:bg-muted"
                disabled={salvando}
                onClick={onDesfazer}
              >
                <Undo2 className="h-3 w-3" />
              </BotaoDecisao>
            )}
          </span>
        )}
      </span>
    </li>
  );
}

function BotaoDecisao({
  titulo,
  ativo,
  classeAtiva,
  classeHover,
  disabled,
  onClick,
  children,
}: {
  titulo: string;
  ativo: boolean;
  classeAtiva: string;
  classeHover: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      aria-pressed={ativo}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-5 w-5 items-center justify-center rounded border text-muted-foreground transition-colors disabled:opacity-40",
        ativo ? `${classeAtiva} border-transparent` : `border-transparent ${classeHover}`,
      )}
    >
      {children}
    </button>
  );
}

// ─── Diálogo do pedido de revisão ────────────────────────────────────────────

/**
 * Um comentário só — não é um chat. Foi pedido assim: o diretor diz o que
 * mudar, o gestor edita, e a edição devolve o item à fila dele
 * (`decisaoVencida`). O histórico de quem decidiu o quê fica na trilha.
 */
function DialogRevisao({
  item,
  salvando,
  onFechar,
  onConfirmar,
}: {
  item: PreviaSetorItem | null;
  salvando: boolean;
  onFechar: () => void;
  onConfirmar: (item: PreviaSetorItem, comentario: string) => void;
}) {
  const [texto, setTexto] = useState("");

  return (
    <Dialog
      open={item !== null}
      onOpenChange={(aberto) => {
        if (!aberto) {
          setTexto("");
          onFechar();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pedir revisão</DialogTitle>
          <DialogDescription>
            {item?.nome} — o gestor volta a poder editar esta despesa e vê o seu comentário na
            prévia.
          </DialogDescription>
        </DialogHeader>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={4}
          autoFocus
          placeholder="O que precisa mudar?"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button
            onClick={() => item && onConfirmar(item, texto)}
            disabled={salvando || texto.trim() === ""}
          >
            {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Enviar ao gestor
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
