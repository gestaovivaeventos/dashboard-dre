"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, RotateCcw, Send, Sparkles, X } from "lucide-react";

import {
  adicionarDespesa,
  type PlanejamentoGrupoOption,
} from "@/lib/orcamento/actions/planejamento-categoria";
import { reiniciarEntrevista } from "@/lib/orcamento/actions/planejamento-entrevista";
import { formatBRL, numberToInput, parseBrNumber } from "@/lib/orcamento/format";
import {
  extrairCartaoDespesa,
  PERIODICIDADES,
  totalItem,
  type CartaoDespesa,
  type Periodicidade,
  type PlanejamentoMensagem,
} from "@/lib/orcamento/planejamento-calc";
import { cn } from "@/lib/utils";

const MESES = [
  "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez",
];

const INPUT_CLS =
  "rounded-md border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

interface Props {
  companyId: string;
  year: number;
  categoryCode: string;
  categoryName: string;
  setorId: string | null;
  conversa: PlanejamentoMensagem[];
  justificativa: string;
  grupos: PlanejamentoGrupoOption[];
  baseSalva: boolean;
  podeEscrever: boolean;
  realizadoMeses: (number | null)[] | null;
  onDespesaAdicionada: () => void;
  onConversaMudou: () => void;
}

/**
 * ETAPA 2 — a entrevista.
 *
 * A IA responde em streaming e pode terminar a mensagem com um CARTÃO de
 * despesa. O cartão não grava nada: ele vira um formulário conferível, e só o
 * clique do gestor cria a linha no orçamento (decisão do dono do projeto em
 * 23/09/2026 — a IA sugere, quem grava é o gestor). É por isso que o texto é
 * cortado no primeiro "[[": os marcadores nunca aparecem na tela.
 *
 * Reiniciar apaga só a CONVERSA. As despesas já confirmadas ficam — são
 * orçamento, não conversa, e some-las sem pedir seria destruir trabalho.
 */
export function PlanejamentoEntrevista({
  companyId,
  year,
  categoryCode,
  categoryName,
  setorId,
  conversa,
  justificativa,
  grupos,
  baseSalva,
  podeEscrever,
  realizadoMeses,
  onDespesaAdicionada,
  onConversaMudou,
}: Props) {
  const [mensagens, setMensagens] = useState<PlanejamentoMensagem[]>(conversa);
  const [texto, setTexto] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [parcial, setParcial] = useState("");
  const [podeFechar, setPodeFechar] = useState(false);
  const [cartao, setCartao] = useState<CartaoDespesa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvandoCartao, setSalvandoCartao] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);

  // Ressincroniza quando o pai recarrega (troca de setor, por exemplo).
  useEffect(() => {
    setMensagens(conversa);
    setCartao(null);
    setPodeFechar(false);
    setParcial("");
  }, [conversa]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensagens, parcial, cartao]);

  async function enviar(conteudo: string, modo: "entrevista" | "fechamento" = "entrevista") {
    if (streaming) return;
    setErro(null);
    setCartao(null);
    setStreaming(true);
    setParcial("");

    const historico = modo === "fechamento" ? mensagens : mensagens;
    if (conteudo.trim()) {
      setMensagens((m) => [...m, { role: "user", content: conteudo.trim() }]);
      setTexto("");
    }

    try {
      const resp = await fetch("/api/orcamento/planejamento/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyId,
          year,
          categoryCode,
          categoryName,
          setorId,
          conversa: historico,
          texto: conteudo,
          modo,
          realizadoCache: realizadoMeses ? { meses: realizadoMeses } : null,
        }),
      });

      if (!resp.ok || !resp.body) {
        const j = (await resp.json().catch(() => null)) as { error?: string } | null;
        setErro(j?.error ?? "Não consegui falar com a IA agora.");
        setStreaming(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let bruto = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bruto += decoder.decode(value, { stream: true });
        // A cada quadro o texto é relido inteiro: um marcador ainda pela metade
        // simplesmente não casa, e nada pisca na tela.
        setParcial(extrairCartaoDespesa(bruto).texto);
      }

      const final = extrairCartaoDespesa(bruto);
      setParcial("");
      setPodeFechar(final.podeFechar);
      setCartao(final.cartao);

      if (modo === "fechamento") {
        // A resposta inteira É a justificativa; o servidor já a gravou.
        onConversaMudou();
      } else {
        setMensagens((m) => [...m, { role: "assistant", content: final.texto }]);
      }
    } catch {
      setErro("A conexão caiu no meio da resposta. Tente de novo.");
    } finally {
      setStreaming(false);
    }
  }

  /**
   * Frase curta descrevendo o cartão — vira a mensagem que avisa a IA do que o
   * gestor fez com ele.
   */
  function resumoCartao(d: CartaoDespesa): string {
    const ate =
      d.periodicidade !== "anual" && d.mesFim != null && d.mesFim < 12
        ? ` até ${MESES[d.mesFim - 1]}`
        : "";
    return `${d.descricao} — ${formatBRL(d.valor)} ${d.periodicidade}, a partir de ${MESES[d.mesInicio - 1]}${ate}`;
  }

  async function confirmarCartao(dados: CartaoDespesa) {
    setSalvandoCartao(true);
    setErro(null);
    const grupoId = grupos.find(
      (g) => g.name.localeCompare(dados.grupo ?? "", "pt-BR", { sensitivity: "base" }) === 0,
    )?.id;
    const res = await adicionarDespesa(companyId, year, categoryCode, setorId, {
      descricao: dados.descricao,
      grupoId: grupoId ?? null,
      valor: dados.valor,
      periodicidade: dados.periodicidade,
      mesInicio: dados.mesInicio,
      mesFim: dados.mesFim,
      fornecedor: dados.fornecedor,
      origem: dados.origem,
      baseId: null,
    });
    setSalvandoCartao(false);
    if (res.error) {
      setErro(res.error);
      return;
    }
    setCartao(null);
    onDespesaAdicionada();
    // A IA só fala quando recebe um turno. Sem este aviso ela não sabe que a
    // despesa entrou e a conversa fica parada esperando o gestor digitar — era
    // por isso que ela não perguntava pela próxima.
    void enviar(`Adicionei ao orçamento: ${resumoCartao(dados)}.`);
  }

  const vazia = mensagens.length === 0;

  return (
    <section className="flex flex-col rounded-xl border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h3 className="font-semibold">Entrevista</h3>
          <p className="text-xs text-muted-foreground">
            Orçamento base zero: a IA pergunta para você decidir, não para confirmar o ano passado.
          </p>
        </div>
        {mensagens.length > 0 && podeEscrever && (
          <button
            onClick={async () => {
              if (!window.confirm("Reiniciar a conversa? As despesas já confirmadas continuam.")) {
                return;
              }
              await reiniciarEntrevista(companyId, year, categoryCode, setorId);
              setMensagens([]);
              setCartao(null);
              setPodeFechar(false);
              onConversaMudou();
            }}
            disabled={streaming}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reiniciar
          </button>
        )}
      </header>

      {!baseSalva && (
        <div className="border-b bg-amber-500/5 px-4 py-2 text-xs text-amber-800">
          A base de {year - 1} ainda não foi finalizada pela administração. Você pode conversar, mas
          a IA não vê o histórico desta categoria.
        </div>
      )}

      <div className="max-h-[28rem] min-h-[16rem] space-y-3 overflow-y-auto px-4 py-3">
        {vazia && !streaming ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-8 text-center">
            <Sparkles className="h-6 w-6 text-emerald-600" />
            <p className="max-w-sm text-sm text-muted-foreground">
              A IA abre a conversa com o que saiu em {year - 1} e o que muda no seu setor em {year}.
            </p>
            <button
              onClick={() => void enviar("")}
              disabled={!podeEscrever}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Começar entrevista
            </button>
          </div>
        ) : (
          mensagens.map((m, i) => (
            <div
              key={i}
              className={cn(
                "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
                m.role === "user"
                  ? "ml-auto bg-emerald-600 text-white"
                  : "bg-muted text-foreground",
              )}
            >
              {m.content}
            </div>
          ))
        )}

        {streaming && parcial && (
          <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm">
            {parcial}
          </div>
        )}
        {streaming && !parcial && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> pensando…
          </div>
        )}

        {cartao && (
          <CartaoDespesaForm
            cartao={cartao}
            grupos={grupos}
            salvando={salvandoCartao}
            onCancelar={() => {
              const descartado = cartao;
              setCartao(null);
              // Mesma razão do confirmar: sem o aviso, a IA fica esperando e o
              // gestor tem de reabrir o assunto sozinho.
              void enviar(
                `Descartei a sugestão de ${descartado.descricao}. Não quero incluir essa despesa.`,
              );
            }}
            onConfirmar={confirmarCartao}
          />
        )}

        <div ref={fimRef} />
      </div>

      {erro && <div className="bg-destructive/10 px-4 py-2 text-xs text-destructive">{erro}</div>}

      {justificativa && (
        <div className="border-t bg-muted/20 px-4 py-3">
          <div className="text-xs font-semibold">Justificativa do orçamento</div>
          <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{justificativa}</p>
        </div>
      )}

      <div className="flex items-end gap-2 border-t px-4 py-3">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (texto.trim()) void enviar(texto);
            }
          }}
          rows={2}
          placeholder={podeEscrever ? "Responda aqui…" : "Você não pode editar este setor."}
          disabled={streaming || !podeEscrever || vazia}
          className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        <button
          onClick={() => texto.trim() && void enviar(texto)}
          disabled={streaming || !texto.trim() || !podeEscrever}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>

      {podeFechar && podeEscrever && (
        <div className="border-t bg-emerald-500/5 px-4 py-2.5">
          <button
            onClick={() => void enviar("", "fechamento")}
            disabled={streaming}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Encerrar e gerar a justificativa
          </button>
          <p className="mt-1 text-[11px] text-muted-foreground">
            As despesas já estão gravadas. Isto escreve o texto que a diretoria lê na validação.
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * O cartão que a IA propôs, como formulário conferível.
 *
 * Nasce preenchido com o que ela entendeu e é totalmente editável: é a última
 * chance de corrigir antes de virar linha do orçamento.
 */
function CartaoDespesaForm({
  cartao,
  grupos,
  salvando,
  onCancelar,
  onConfirmar,
}: {
  cartao: CartaoDespesa;
  grupos: PlanejamentoGrupoOption[];
  salvando: boolean;
  onCancelar: () => void;
  onConfirmar: (c: CartaoDespesa) => void;
}) {
  const grupoInicial =
    grupos.find(
      (g) => g.name.localeCompare(cartao.grupo ?? "", "pt-BR", { sensitivity: "base" }) === 0,
    )?.name ?? "";

  const [descricao, setDescricao] = useState(cartao.descricao);
  const [grupo, setGrupo] = useState(grupoInicial);
  const [valor, setValor] = useState(numberToInput(cartao.valor));
  const [periodicidade, setPeriodicidade] = useState<Periodicidade>(cartao.periodicidade);
  const [mesInicio, setMesInicio] = useState(cartao.mesInicio);
  const [mesFim, setMesFim] = useState(cartao.mesFim == null ? "" : String(cartao.mesFim));

  const valorNum = parseBrNumber(valor);
  const valido = descricao.trim().length > 0 && valorNum != null && !Number.isNaN(valorNum);

  return (
    <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
        <Sparkles className="h-3.5 w-3.5" />
        Confirmar esta despesa?
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            className={INPUT_CLS + " min-w-[12rem] flex-1"}
          />
          <select
            value={grupo}
            onChange={(e) => setGrupo(e.target.value)}
            className={INPUT_CLS}
          >
            <option value="">— sem grupo —</option>
            {grupos.map((g) => (
              <option key={g.id} value={g.name}>
                {g.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            R$
            <input
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              className={INPUT_CLS + " w-28 text-right"}
            />
          </label>
          <select
            value={periodicidade}
            onChange={(e) => setPeriodicidade(e.target.value as Periodicidade)}
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
              value={mesInicio}
              onChange={(e) => setMesInicio(Number(e.target.value))}
              className={INPUT_CLS}
            >
              {MESES.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          {periodicidade !== "anual" && (
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              até
              <select
                value={mesFim}
                onChange={(e) => setMesFim(e.target.value)}
                className={INPUT_CLS}
              >
                <option value="">dez</option>
                {MESES.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-[11px] text-muted-foreground">
            Total no ano:{" "}
            <strong className="tabular-nums">
              {formatBRL(
                valido
                  ? totalItem(valorNum!, mesInicio, periodicidade, mesFim ? Number(mesFim) : null)
                  : 0,
              )}
            </strong>
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={onCancelar}
              disabled={salvando}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" /> Descartar
            </button>
            <button
              onClick={() =>
                onConfirmar({
                  descricao: descricao.trim(),
                  grupo: grupo || null,
                  valor: valorNum ?? 0,
                  periodicidade,
                  mesInicio,
                  mesFim: mesFim ? Number(mesFim) : null,
                  fornecedor: cartao.fornecedor,
                  origem: cartao.origem,
                })
              }
              disabled={salvando || !valido}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {salvando ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Adicionar ao orçamento
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
