"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export interface SetorOpcao {
  id: string;
  name: string;
}

/**
 * Seleção múltipla de setores de UMA categoria.
 *
 * O modelo é "a categoria tem N setores, cada despesa tem 1": aqui se diz quais
 * setores orçam esta categoria. Só as combinações marcadas viram card nas telas
 * de método — sem isso, toda categoria × todo setor viraria linha vazia.
 *
 * Grava ao FECHAR o painel, não a cada clique: marcar três setores seriam três
 * idas ao servidor, e a validação (setor com orçamento lançado não sai) precisa
 * ver a lista final para dar uma mensagem única.
 */
export function SetoresMultiSelect({
  setores,
  selecionados,
  onCommit,
  disabled,
  salvando,
}: {
  setores: SetorOpcao[];
  selecionados: string[];
  onCommit: (ids: string[]) => void;
  disabled?: boolean;
  salvando?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [rascunho, setRascunho] = useState<string[]>(selecionados);
  const caixaRef = useRef<HTMLDivElement>(null);

  // O pai pode recarregar (troca de ano/empresa) — ressincroniza.
  useEffect(() => {
    if (!aberto) setRascunho(selecionados);
  }, [selecionados, aberto]);

  // Fecha ao clicar fora ou com ESC, gravando o que mudou.
  useEffect(() => {
    if (!aberto) return;
    const fechar = () => {
      setAberto(false);
      const mudou =
        rascunho.length !== selecionados.length ||
        rascunho.some((id) => !selecionados.includes(id));
      if (mudou) onCommit(rascunho);
    };
    const onClick = (e: MouseEvent) => {
      if (caixaRef.current && !caixaRef.current.contains(e.target as Node)) fechar();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") fechar();
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [aberto, rascunho, selecionados, onCommit]);

  const nomes = setores.filter((s) => selecionados.includes(s.id)).map((s) => s.name);
  const rotulo =
    nomes.length === 0
      ? "nenhum setor"
      : nomes.length <= 2
        ? nomes.join(", ")
        : `${nomes.length} setores`;

  return (
    <div className="relative" ref={caixaRef}>
      <button
        type="button"
        disabled={disabled || setores.length === 0}
        onClick={() => setAberto((v) => !v)}
        title={nomes.length > 2 ? nomes.join(", ") : undefined}
        className={cn(
          "inline-flex w-full max-w-[15rem] items-center justify-between gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs outline-none hover:bg-muted focus:ring-2 focus:ring-ring disabled:opacity-50",
          nomes.length === 0 && "text-muted-foreground",
        )}
      >
        <span className="truncate">{rotulo}</span>
        {salvando ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        )}
      </button>

      {aberto && (
        <div className="absolute left-0 z-30 mt-1 max-h-64 w-56 overflow-auto rounded-md border bg-popover p-1 shadow-md">
          {setores.map((s) => {
            const marcado = rascunho.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() =>
                  setRascunho((prev) =>
                    prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id],
                  )
                }
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
              >
                <span
                  className={cn(
                    "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                    marcado ? "border-emerald-600 bg-emerald-600 text-white" : "border-input",
                  )}
                >
                  {marcado && <Check className="h-2.5 w-2.5" />}
                </span>
                <span className="truncate">{s.name}</span>
              </button>
            );
          })}
          <p className="px-2 pb-1 pt-1.5 text-[10px] text-muted-foreground">
            Fecha e salva ao clicar fora.
          </p>
        </div>
      )}
    </div>
  );
}
