"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";

import {
  TRANSCRICAO_BITRATE,
  TRANSCRICAO_MAX_SEGUNDOS,
  escolherFormatoGravacao,
} from "@/lib/ai/transcricao";
import { cn } from "@/lib/utils";

interface Props {
  companyId: string;
  categoria: string;
  grupos: readonly string[];
  disabled?: boolean;
  /** Recebe o texto transcrito. Quem chama decide onde ele entra — nunca é enviado sozinho. */
  onTexto: (texto: string) => void;
  onErro: (mensagem: string | null) => void;
}

type Estado = "parado" | "gravando" | "transcrevendo";

function mmss(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Microfone da entrevista: grava, manda para /transcrever e devolve o texto.
 *
 * Some sozinho em navegador sem gravação (ou fora de HTTPS, onde o microfone
 * não é liberado) — botão que não funciona é pior que botão nenhum.
 */
export function BotaoDitado({ companyId, categoria, grupos, disabled, onTexto, onErro }: Props) {
  const [suportado, setSuportado] = useState(false);
  const [estado, setEstado] = useState<Estado>("parado");
  const [segundos, setSegundos] = useState(0);
  const gravadorRef = useRef<MediaRecorder | null>(null);
  const pedacosRef = useRef<Blob[]>([]);
  const relogioRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setSuportado(
      typeof window !== "undefined" &&
        typeof window.MediaRecorder !== "undefined" &&
        Boolean(navigator.mediaDevices?.getUserMedia),
    );
  }, []);

  // Saiu da tela gravando: solta o microfone (senão a luz do mic fica acesa).
  useEffect(() => {
    return () => {
      if (relogioRef.current) clearInterval(relogioRef.current);
      const g = gravadorRef.current;
      if (g && g.state !== "inactive") {
        g.onstop = null;
        g.stop();
      }
      g?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function iniciar() {
    onErro(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const nome = (e as { name?: string })?.name;
      onErro(
        nome === "NotAllowedError"
          ? "O navegador bloqueou o microfone. Libere o acesso no cadeado da barra de endereço e tente de novo."
          : "Não encontrei um microfone neste aparelho.",
      );
      return;
    }

    const mimeType = escolherFormatoGravacao((m) => MediaRecorder.isTypeSupported(m));
    const gravador = new MediaRecorder(
      stream,
      mimeType ? { mimeType, audioBitsPerSecond: TRANSCRICAO_BITRATE } : { audioBitsPerSecond: TRANSCRICAO_BITRATE },
    );
    pedacosRef.current = [];
    gravador.ondataavailable = (ev) => {
      if (ev.data.size > 0) pedacosRef.current.push(ev.data);
    };
    gravador.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const tipo = gravador.mimeType || mimeType || "audio/webm";
      void transcrever(new Blob(pedacosRef.current, { type: tipo }));
    };
    gravadorRef.current = gravador;
    gravador.start();

    setSegundos(0);
    setEstado("gravando");
    relogioRef.current = setInterval(() => setSegundos((s) => s + 1), 1000);
  }

  // Teto de duração: para sozinho e transcreve o que já foi falado.
  useEffect(() => {
    if (estado === "gravando" && segundos >= TRANSCRICAO_MAX_SEGUNDOS) parar();
    // `parar` só lê refs — fora das deps de propósito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado, segundos]);

  function parar() {
    if (relogioRef.current) {
      clearInterval(relogioRef.current);
      relogioRef.current = null;
    }
    const g = gravadorRef.current;
    if (g && g.state !== "inactive") {
      setEstado("transcrevendo");
      g.stop();
    }
  }

  async function transcrever(audio: Blob) {
    if (audio.size === 0) {
      setEstado("parado");
      onErro("A gravação veio vazia. Tente falar de novo.");
      return;
    }
    const corpo = new FormData();
    corpo.append("audio", audio);
    corpo.append("companyId", companyId);
    corpo.append("categoria", categoria);
    corpo.append("grupos", JSON.stringify(grupos));
    try {
      const resp = await fetch("/api/orcamento/planejamento/transcrever", { method: "POST", body: corpo });
      const j = (await resp.json().catch(() => null)) as { texto?: string; aviso?: string; error?: string } | null;
      if (!resp.ok) {
        onErro(j?.error ?? "Não consegui transcrever agora. Tente de novo ou digite a resposta.");
      } else if (j?.texto) {
        onTexto(j.texto);
      } else if (j?.aviso) {
        onErro(j.aviso);
      }
    } catch {
      onErro("A conexão caiu durante a transcrição. Tente de novo.");
    } finally {
      setEstado("parado");
    }
  }

  if (!suportado) return null;

  if (estado === "gravando") {
    return (
      <button
        type="button"
        onClick={parar}
        title="Parar e transcrever"
        className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
      >
        <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
        <span className="tabular-nums">{mmss(segundos)}</span>
        <Square className="h-3.5 w-3.5 fill-current" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void iniciar()}
      disabled={disabled || estado === "transcrevendo"}
      title={estado === "transcrevendo" ? "Transcrevendo…" : "Responder falando"}
      aria-label="Responder falando"
      className={cn(
        "inline-flex items-center rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50",
        estado === "transcrevendo" && "text-muted-foreground",
      )}
    >
      {estado === "transcrevendo" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
    </button>
  );
}
