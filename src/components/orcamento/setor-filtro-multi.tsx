"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Eye } from "lucide-react";

import { cn } from "@/lib/utils";

export interface SetorFiltroOpcao {
  id: string;
  name: string;
  /** Falso = o usuário só enxerga este setor, não grava nele. */
  podeEscrever: boolean;
}

/**
 * Filtro de setores do Planejamento dos gestores.
 *
 * Por que não reusar `SetoresMultiSelect`: aquele é um controle de CADASTRO —
 * grava no servidor ao fechar o painel, porque marcar três setores seriam três
 * idas ao servidor. Aqui o gesto é de FILTRO: cada clique tem de mudar a tela na
 * hora, e não há nada para salvar. Juntar os dois num componente só significaria
 * um `onCommit` que às vezes é imediato e às vezes não — a fonte do tipo de bug
 * que só aparece em produção.
 *
 * Seleção VAZIA quer dizer "nenhum setor", não "todos": a lista fica vazia de
 * propósito. É a mesma convenção do filtro do Caixa (`filter-logic.ts`) —
 * conflar vazio com tudo faz a tela mostrar o consolidado exatamente quando o
 * usuário desmarcou a última caixa.
 */
export function SetorFiltroMulti({
  setores,
  selecionados,
  onChange,
  disabled,
}: {
  setores: SetorFiltroOpcao[];
  selecionados: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const caixaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const onClick = (e: MouseEvent) => {
      if (caixaRef.current?.contains(e.target as Node)) return;
      setAberto(false);
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

  const filtrados = busca.trim()
    ? setores.filter((s) =>
        s.name.toLocaleLowerCase("pt-BR").includes(busca.trim().toLocaleLowerCase("pt-BR")),
      )
    : setores;

  const nomes = setores.filter((s) => selecionados.includes(s.id)).map((s) => s.name);
  const rotulo =
    nomes.length === 0
      ? "nenhum setor"
      : nomes.length === setores.length
        ? `todos os setores (${nomes.length})`
        : nomes.length <= 2
          ? nomes.join(", ")
          : `${nomes.length} setores`;

  function alternar(id: string) {
    onChange(
      selecionados.includes(id)
        ? selecionados.filter((x) => x !== id)
        : [...selecionados, id],
    );
  }

  return (
    <div className="relative" ref={caixaRef}>
      <button
        type="button"
        disabled={disabled || setores.length === 0}
        onClick={() => setAberto((v) => !v)}
        title={nomes.length > 2 ? nomes.join(", ") : undefined}
        className={cn(
          "inline-flex min-w-[15rem] items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm outline-none hover:bg-muted focus:ring-2 focus:ring-ring disabled:opacity-50",
          nomes.length === 0 && "text-muted-foreground",
        )}
      >
        <span className="truncate">{rotulo}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
      </button>

      {aberto && (
        <div className="absolute left-0 z-50 mt-1 max-h-80 w-[20rem] overflow-auto rounded-md border bg-popover p-1 shadow-lg">
          {setores.length > 6 && (
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar setor…"
              autoFocus
              className="mb-1 w-full rounded border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
          )}

          <div className="flex items-center gap-1 border-b px-1 pb-1">
            <button
              type="button"
              onClick={() => onChange(setores.map((s) => s.id))}
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Selecionar todos
            </button>
            <button
              type="button"
              onClick={() => onChange([])}
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Limpar
            </button>
          </div>

          {filtrados.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              Nenhum setor encontrado.
            </p>
          ) : (
            filtrados.map((s) => {
              const marcado = selecionados.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => alternar(s.id)}
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
                  <span className="break-words">{s.name}</span>
                  {/* Setor que ele enxerga mas não constrói (Gerente Sócio, ou
                      a diretoria fora da janela de validação). Mostrar sem
                      avisar faria a pessoa descobrir só ao tentar salvar. */}
                  {!s.podeEscrever && (
                    <span
                      title="Você vê este setor, mas não pode alterar o orçamento dele."
                      className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground"
                    >
                      <Eye className="h-3 w-3" /> leitura
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
