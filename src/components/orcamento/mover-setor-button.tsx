"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRightLeft, Loader2 } from "lucide-react";

import {
  moverLinhaDeSetor,
  type MetodoComSetor,
} from "@/lib/orcamento/actions/mover-setor";
import type { OrcamentoSetor } from "@/lib/orcamento/actions/setores";
import { cn } from "@/lib/utils";

/**
 * Move uma linha de orçamento para outro setor (admin).
 *
 * Serve para dois momentos: esvaziar o "Não atribuído" que a migração por setor
 * criou, e corrigir o setor de uma despesa que o departamento do lançamento
 * classificou errado. Move a DESPESA, nunca a categoria — a categoria só é
 * atribuída ao destino para a linha não pousar num setor que não a lista.
 */
export function MoverSetorButton({
  companyId,
  year,
  metodo,
  categoryCode,
  origemSetorId,
  setores,
  linhaId,
  onMoved,
  onError,
}: {
  companyId: string;
  year: number;
  metodo: MetodoComSetor;
  categoryCode: string;
  origemSetorId: string | null;
  /** Setores ativos da empresa/ano (o de origem é filtrado fora). */
  setores: OrcamentoSetor[];
  /** Só no valor fixo, que tem N contratos por categoria. */
  linhaId?: string;
  onMoved: () => void;
  onError: (msg: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [movendo, setMovendo] = useState(false);
  const caixaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const onClick = (e: MouseEvent) => {
      if (caixaRef.current && !caixaRef.current.contains(e.target as Node)) setAberto(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [aberto]);

  const destinos = setores.filter((s) => s.id !== origemSetorId);
  if (destinos.length === 0) return null;

  async function mover(destinoSetorId: string) {
    setAberto(false);
    setMovendo(true);
    const res = await moverLinhaDeSetor({
      companyId,
      year,
      metodo,
      categoryCode,
      origemSetorId,
      destinoSetorId,
      linhaId,
    });
    setMovendo(false);
    if (res?.error) {
      onError(res.error);
      return;
    }
    onMoved();
  }

  return (
    <div className="relative" ref={caixaRef}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        disabled={movendo}
        title="Mover esta despesa para outro setor"
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50",
        )}
      >
        {movendo ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ArrowRightLeft className="h-3.5 w-3.5" />
        )}
        Mover
      </button>

      {aberto && (
        <div className="absolute right-0 z-30 mt-1 max-h-64 w-56 overflow-auto rounded-md border bg-popover p-1 shadow-md">
          <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Mover para
          </p>
          {destinos.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => void mover(s.id)}
              className="block w-full truncate rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
