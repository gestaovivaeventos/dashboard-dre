"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, MapPin, Send, Sparkles, Trash2, X } from "lucide-react";

import {
  limparConversaViagem,
  salvarEnderecoViagem,
} from "@/lib/orcamento/actions/viagens-entrevista";
import { extrairCartaoViagem, type CartaoViagem, type MensagemViagem } from "@/lib/viagens/cartao";
import { BotaoDitado } from "@/components/orcamento/botao-ditado";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A ENTREVISTA de uma viagem.
 *
 * ── A IA propõe, o gestor grava ───────────────────────────────────────────
 * Quando o roteiro fecha, a IA emite o cartão e esta tela o mostra como uma
 * PROPOSTA. O clique em "Preencher o formulário" só mexe no rascunho da tela da
 * viagem — gravar continua sendo o botão "Salvar e calcular", que é onde o custo
 * é calculado e as travas valem. Nenhum caminho de escrita nasce aqui.
 *
 * ── A IA precisa SABER o que o gestor fez com o cartão ────────────────────
 * Preencher e descartar são cliques só do cliente. Sem avisar, a conversa fica
 * parada esperando uma resposta que já foi dada por gesto — foi o defeito que
 * apareceu em teste real no Planejamento (24/09/2026). Por isso os dois botões
 * mandam um turno automático dizendo o que aconteceu.
 */

/** Assinatura do conteúdo, para ressincronizar só quando a conversa MUDOU. */
function assinatura(conversa: readonly MensagemViagem[]): string {
  return `${conversa.length}|${conversa.map((m) => m.content.length).join(",")}`;
}

/** Negrito de `**assim**` sem renderizar markdown inteiro. */
function comNegrito(texto: string) {
  const partes = texto.split(/(\*\*[^*]+\*\*)/g);
  return partes.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") && p.length > 4 ? (
      <strong key={i}>{p.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

function resumoDoCartao(c: CartaoViagem): string[] {
  const linhas: string[] = [];
  if (c.origem) linhas.push(`Sai de ${c.origem}`);
  if (c.dataIda) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(c.dataIda);
    if (m) linhas.push(`Ida em ${Number(m[3])}/${m[2]}/${m[1]}`);
  }
  if (c.pessoas != null) {
    const quartos =
      c.pessoasPorQuarto != null ? Math.ceil(c.pessoas / c.pessoasPorQuarto) : null;
    linhas.push(
      `${c.pessoas} pessoa(s)${quartos != null ? ` em ${quartos} quarto(s)` : ""}`,
    );
  }
  for (const p of c.paradas) {
    const preco =
      p.chegadaPrecoTotal != null
        ? "preço fechado"
        : p.chegadaPrecoPessoa != null
          ? "preço por pessoa"
          : p.chegadaDistanciaKm != null
            ? `${p.chegadaDistanciaKm} km (estimado)`
            : "sem preço nem distância";
    linhas.push(
      `${p.cidade}: ${p.noites} noite(s), de ${p.chegadaModal} — ${preco}${
        p.localDestino ? ` · ${p.localDestino}` : ""
      }`,
    );
  }
  if (c.voltaModal) linhas.push(`Volta de ${c.voltaModal}`);
  for (const o of c.outros) linhas.push(`${o.descricao}: R$ ${o.valor.toFixed(2)}`);
  return linhas;
}

/** Os endereços que o cartão trouxe e que valeria guardar no cadastro. */
function enderecosDoCartao(c: CartaoViagem): Array<{ cidade: string; nome: string; endereco: string }> {
  const out: Array<{ cidade: string; nome: string; endereco: string }> = [];
  for (const p of c.paradas) {
    if (p.localDestino && p.localEndereco) {
      out.push({ cidade: p.cidade, nome: p.localDestino, endereco: p.localEndereco });
    }
  }
  return out;
}

export function ViagemEntrevista({
  companyId,
  year,
  viagemId,
  titulo,
  cidades,
  conversa,
  podeEscrever,
  onCartao,
  onConversaMudou,
}: {
  companyId: string;
  year: number;
  viagemId: string;
  titulo: string;
  /** Cidades já no roteiro — vão como vocabulário do ditado (nome próprio). */
  cidades: string[];
  conversa: MensagemViagem[];
  podeEscrever: boolean;
  /** Aplica o roteiro proposto ao rascunho da tela (não grava). */
  onCartao: (c: CartaoViagem) => void;
  /** A conversa mudou no servidor — o pai pode recarregar o que precisar. */
  onConversaMudou?: () => void;
}) {
  const [mensagens, setMensagens] = useState<MensagemViagem[]>(conversa);
  const [texto, setTexto] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [parcial, setParcial] = useState("");
  const [cartao, setCartao] = useState<CartaoViagem | null>(null);
  const [podeFechar, setPodeFechar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [guardarEnderecos, setGuardarEnderecos] = useState(true);
  const rolagemRef = useRef<HTMLDivElement>(null);
  const caixaRef = useRef<HTMLTextAreaElement>(null);
  const assinaturaRef = useRef(assinatura(conversa));

  // Ressincroniza quando o pai recarrega, mas SÓ quando o conteúdo mudou. O pai
  // recarrega a viagem a cada gravação e devolve um array novo com o mesmo
  // conteúdo: comparando por identidade, este efeito rodaria à toa, puxando a
  // página para o chat e zerando o cartão que a IA acabou de propor.
  const assin = assinatura(conversa);
  useEffect(() => {
    if (assinaturaRef.current === assin) return;
    assinaturaRef.current = assin;
    setMensagens(conversa);
    setCartao(null);
    setParcial("");
    setPodeFechar(false);
    // `conversa` fora das deps de propósito: a assinatura já a representa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assin]);

  useEffect(() => {
    const el = rolagemRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mensagens, parcial]);

  async function enviar(conteudo: string) {
    if (streaming) return;
    setErro(null);
    setCartao(null);
    setStreaming(true);
    setParcial("");

    const historico = mensagens;
    if (conteudo.trim()) {
      setMensagens((m) => [...m, { role: "user", content: conteudo.trim() }]);
      setTexto("");
    }

    try {
      const resp = await fetch("/api/orcamento/viagens/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId, year, viagemId, conversa: historico, texto: conteudo }),
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
        // A cada quadro o texto é relido inteiro: marcador pela metade não casa,
        // e nada pisca na tela.
        setParcial(extrairCartaoViagem(bruto).texto);
      }

      const final = extrairCartaoViagem(bruto);
      setParcial("");
      setPodeFechar(final.podeFechar);
      setCartao(final.cartao);
      setMensagens((m) => [...m, { role: "assistant", content: final.texto }]);
      onConversaMudou?.();
    } catch {
      setErro("A conexão caiu no meio da resposta. Tente de novo.");
    } finally {
      setStreaming(false);
    }
  }

  async function aplicar(c: CartaoViagem) {
    onCartao(c);
    setCartao(null);

    // O endereço que a IA propôs só vale depois de alguém aceitá-lo — este
    // clique É a confirmação. Falha ao guardar não desfaz o preenchimento: o
    // roteiro é o que importa, o cadastro é conveniência para a próxima viagem.
    if (guardarEnderecos) {
      for (const e of enderecosDoCartao(c)) {
        await salvarEnderecoViagem(companyId, year, { ...e, tipo: "outro", fonte: "ia" });
      }
    }

    const destinos = c.paradas.map((p) => p.cidade).join(", ");
    void enviar(
      `Preenchi o formulário com esse roteiro (${destinos}). Se faltar algo, me diga o que ainda precisa ser definido.`,
    );
  }

  function descartar() {
    setCartao(null);
    void enviar("Descartei esse roteiro. Vamos ajustar.");
  }

  async function recomecar() {
    if (!window.confirm("Apagar a conversa? O roteiro já gravado não é afetado.")) return;
    const res = await limparConversaViagem(companyId, year, viagemId);
    if (res.error) {
      setErro(res.error);
      return;
    }
    setMensagens([]);
    setCartao(null);
    setPodeFechar(false);
    onConversaMudou?.();
  }

  const vazia = mensagens.length === 0 && !streaming && !parcial;

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          Montar conversando
        </h3>
        {mensagens.length > 0 && podeEscrever && (
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => void recomecar()}>
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            Recomeçar
          </Button>
        )}
      </div>

      {vazia && (
        <p className="text-xs text-muted-foreground">
          Descreva a viagem como você a explicaria a um colega — para que serve, para onde, quando e
          quem vai. A IA levanta o roteiro e propõe o preenchimento; o <strong>custo</strong> é
          calculado pelo sistema, não por ela.
        </p>
      )}

      {/* ── A conversa ── */}
      {(mensagens.length > 0 || parcial || streaming) && (
        <div
          ref={rolagemRef}
          className="max-h-80 space-y-2.5 overflow-y-auto rounded-md border bg-muted/20 p-3"
        >
          {mensagens.map((m, i) => (
            <div
              key={i}
              className={cn(
                "max-w-[90%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                m.role === "user"
                  ? "ml-auto bg-primary/10"
                  : "mr-auto bg-background border",
              )}
            >
              {comNegrito(m.content)}
            </div>
          ))}
          {parcial && (
            <div className="mr-auto max-w-[90%] whitespace-pre-wrap rounded-lg border bg-background px-3 py-2 text-sm">
              {comNegrito(parcial)}
            </div>
          )}
          {streaming && !parcial && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              pensando…
            </div>
          )}
        </div>
      )}

      {erro && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-2.5 text-xs text-red-700 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      {/* ── O cartão proposto ── */}
      {cartao && podeEscrever && (
        <div className="space-y-2.5 rounded-md border border-sky-500/40 bg-sky-500/5 p-3">
          <p className="text-xs font-semibold uppercase text-sky-700 dark:text-sky-400">
            Roteiro proposto
          </p>
          <ul className="space-y-0.5 text-xs">
            {resumoDoCartao(cartao).map((l, i) => (
              <li key={i}>• {l}</li>
            ))}
          </ul>

          {enderecosDoCartao(cartao).length > 0 && (
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={guardarEnderecos}
                onChange={(e) => setGuardarEnderecos(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <MapPin className="mr-1 inline h-3 w-3" />
                Guardar{" "}
                {enderecosDoCartao(cartao)
                  .map((e) => e.nome)
                  .join(", ")}{" "}
                no cadastro de endereços — a próxima viagem à mesma cidade reusa em vez de buscar de
                novo. <strong>Confira antes:</strong> endereço errado muda o custo do deslocamento.
              </span>
            </label>
          )}

          <p className="text-xs text-muted-foreground">
            Isto só preenche o formulário acima. O custo aparece depois de “Salvar e calcular”.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void aplicar(cartao)} disabled={streaming}>
              <Check className="mr-1.5 h-3.5 w-3.5" />
              Preencher o formulário
            </Button>
            <Button size="sm" variant="ghost" onClick={descartar} disabled={streaming}>
              <X className="mr-1.5 h-3.5 w-3.5" />
              Descartar
            </Button>
          </div>
        </div>
      )}

      {podeFechar && !cartao && (
        <p className="text-xs text-muted-foreground">
          A IA considera o roteiro fechado. Confira o formulário acima e salve.
        </p>
      )}

      {/* ── A caixa de resposta ── */}
      {podeEscrever && (
        <div className="flex items-end gap-2">
          <textarea
            ref={caixaRef}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (texto.trim()) void enviar(texto);
              }
            }}
            rows={2}
            disabled={streaming}
            placeholder={
              mensagens.length === 0
                ? "Ex.: preciso levar duas pessoas a Curitiba e Florianópolis em maio para treinar as equipes novas"
                : "Responda aqui…"
            }
            className="min-h-[2.5rem] flex-1 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
          />
          <BotaoDitado
            companyId={companyId}
            categoria={titulo}
            grupos={cidades}
            disabled={streaming}
            onTexto={(t) => setTexto((atual) => (atual ? `${atual} ${t}` : t))}
            onErro={(m) => setErro(m)}
          />
          <Button
            size="sm"
            onClick={() => texto.trim() && void enviar(texto)}
            disabled={streaming || !texto.trim()}
          >
            {streaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      )}

      {vazia && podeEscrever && (
        <Button size="sm" variant="outline" onClick={() => void enviar("")} disabled={streaming}>
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          Começar a conversa
        </Button>
      )}
    </section>
  );
}
