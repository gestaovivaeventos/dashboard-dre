"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, MessageCircle, Send, X } from "lucide-react";

import {
  answerPaymentInfo,
  getPaymentInfoThread,
  requestPaymentInfo,
  type PaymentInfoMessage,
} from "@/lib/ctrl/actions/requests";

interface Props {
  requestId: string;
  requestNumber: number;
  requestTitle: string;
  /**
   * "ask": usuario de contas_a_pagar abrindo/continuando a conversa.
   * "answer": solicitante respondendo a pergunta pendente.
   * "view": apenas leitura (status nao permite acao, ou perfil sem permissao).
   */
  mode: "ask" | "answer" | "view";
  onClose: () => void;
  /** Chamado depois de um envio bem-sucedido — pai pode recarregar a tela. */
  onSubmitted?: () => void;
}

export function PaymentInfoThreadModal({
  requestId,
  requestNumber,
  requestTitle,
  mode,
  onClose,
  onSubmitted,
}: Props) {
  const [messages, setMessages] = useState<PaymentInfoMessage[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    (async () => {
      const result = await getPaymentInfoThread(requestId);
      if (!alive) return;
      if (result.error) {
        setLoadError(result.error);
        setMessages([]);
        return;
      }
      setMessages(result.messages ?? []);
    })();
    return () => {
      alive = false;
    };
  }, [requestId]);

  function submit() {
    if (!text.trim()) {
      setSubmitError("Mensagem não pode ficar vazia.");
      return;
    }
    setSubmitError(null);
    startTransition(async () => {
      const result =
        mode === "ask"
          ? await requestPaymentInfo(requestId, text.trim())
          : await answerPaymentInfo(requestId, text.trim());
      if ("error" in result && result.error) {
        setSubmitError(result.error);
        return;
      }
      onSubmitted?.();
      onClose();
    });
  }

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => !isPending && onClose()}
    >
      <div
        className="w-full max-w-2xl rounded-xl border bg-background shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-violet-600" />
              <h3 className="font-semibold">Informações sobre pagamento</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Requisição #{requestNumber} · {requestTitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            aria-label="Fechar"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto bg-muted/20 px-6 py-5 space-y-3">
          {loadError && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {loadError}
            </p>
          )}

          {messages === null ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <p className="rounded-md border border-dashed bg-background px-3 py-2 text-sm text-muted-foreground">
              Nenhuma mensagem ainda nesta conversa.
            </p>
          ) : (
            messages.map((m) => {
              const isContas = m.authorKind === "contas_a_pagar";
              const author = m.authorName ?? m.authorEmail ?? "Usuário";
              return (
                <div
                  key={m.id}
                  className={`flex flex-col ${
                    isContas ? "items-start" : "items-end"
                  }`}
                >
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm ${
                      isContas
                        ? "bg-violet-50 text-violet-900 dark:bg-violet-950/40 dark:text-violet-200"
                        : "bg-green-50 text-green-900 dark:bg-green-950/40 dark:text-green-200"
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.message}</p>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {isContas ? "Contas a Pagar" : "Solicitante"} ·{" "}
                    <span className="font-medium">{author}</span> · {fmtDate(m.createdAt)}
                  </p>
                </div>
              );
            })
          )}
        </div>

        {mode === "view" ? (
          <div className="border-t px-6 py-4 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              Fechar
            </button>
          </div>
        ) : (
          <div className="border-t px-6 py-4 space-y-3">
            {submitError && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {submitError}
              </p>
            )}
            <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {mode === "ask" ? "Sua pergunta" : "Sua resposta"}
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              disabled={isPending}
              placeholder={
                mode === "ask"
                  ? "Ex: O boleto está com vencimento errado, pode reenviar?"
                  : "Escreva a resposta para o time de contas a pagar..."
              }
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {mode === "ask"
                  ? "Ao enviar, o status muda para Info pendente e o envio fica bloqueado."
                  : "Ao responder, a requisição volta a Aguardando envio."}
              </p>
              <button
                type="button"
                onClick={submit}
                disabled={isPending || !text.trim()}
                className="inline-flex items-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {mode === "ask" ? "Enviar pergunta" : "Enviar resposta"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
