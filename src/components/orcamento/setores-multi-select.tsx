"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  unico,
}: {
  setores: SetorOpcao[];
  selecionados: string[];
  onCommit: (ids: string[]) => void;
  disabled?: boolean;
  salvando?: boolean;
  /** Escolha ÚNICA. A média é assim: o valor vem do realizado da categoria
   * inteira, então dois setores contariam a mesma despesa duas vezes. */
  unico?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [rascunho, setRascunho] = useState<string[]>(selecionados);
  // A tabela desta tela fica dentro de um `overflow-x-auto`, que recortaria um
  // painel absoluto. Portal + posição fixa medida no botão resolve, e o nome
  // do setor aparece inteiro.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const caixaRef = useRef<HTMLDivElement>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const painelRef = useRef<HTMLDivElement>(null);

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
      const alvo = e.target as Node;
      if (caixaRef.current?.contains(alvo) || painelRef.current?.contains(alvo))
        return;
      fechar();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") fechar();
    };
    // Painel fixo: rolar a página o deixaria para trás.
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("scroll", fechar, true);
    window.addEventListener("resize", fechar);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("scroll", fechar, true);
      window.removeEventListener("resize", fechar);
    };
  }, [aberto, rascunho, selecionados, onCommit]);

  const nomes = setores
    .filter((s) => selecionados.includes(s.id))
    .map((s) => s.name);
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
        ref={botaoRef}
        onClick={() => {
          if (aberto) {
            setAberto(false);
            return;
          }
          const r = botaoRef.current?.getBoundingClientRect();
          if (r) setPos({ top: r.bottom + 4, left: r.left });
          setAberto(true);
        }}
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

      {aberto &&
        pos &&
        createPortal(
          <div
            ref={painelRef}
            style={{ top: pos.top, left: pos.left }}
            className="fixed z-50 max-h-72 min-w-[14rem] max-w-[22rem] overflow-auto rounded-md border bg-popover p-1 shadow-lg"
          >
            {setores.map((s) => {
              const marcado = rascunho.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() =>
                    setRascunho((prev) =>
                      unico
                        ? prev.includes(s.id)
                          ? []
                          : [s.id]
                        : prev.includes(s.id)
                          ? prev.filter((x) => x !== s.id)
                          : [...prev, s.id],
                    )
                  }
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                >
                  <span
                    className={cn(
                      "flex h-3.5 w-3.5 shrink-0 items-center justify-center border",
                      unico ? "rounded-full" : "rounded",
                      marcado
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-input",
                    )}
                  >
                    {marcado && <Check className="h-2.5 w-2.5" />}
                  </span>
                  <span className="break-words">{s.name}</span>
                </button>
              );
            })}
            <p className="px-2 pb-1 pt-1.5 text-[10px] text-muted-foreground">
              {unico ? "Um setor só (método média). " : ""}Fecha e salva ao
              clicar fora.
            </p>
          </div>,
          document.body,
        )}
    </div>
  );
}
