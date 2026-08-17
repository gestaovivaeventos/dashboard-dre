"use client";

import { Search, Tags, X } from "lucide-react";
import { useMemo, useState } from "react";

export interface ExpenseTypePickerOption {
  id: string;
  name: string;
}

interface ExpenseTypePickerProps {
  options: ExpenseTypePickerOption[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  /** Quando informado, mostra o atalho "Limpar seleção". */
  onClear?: () => void;
  /** Texto exibido quando não há nenhum tipo cadastrado. */
  emptyMessage?: string;
  /** Prefixo dos ids do DOM — a tela de aprovação e a de cadastro podem coexistir. */
  idPrefix: string;
}

// A busca ignora acento e caixa: "acoes" acha "Ações Endomarketing".
const COMBINING_DIACRITICS = /[̀-ͯ]/g;

function normalize(value: string): string {
  return value.normalize("NFD").replace(COMBINING_DIACRITICS, "").toLowerCase().trim();
}

/**
 * Seleção múltipla de tipos de despesa com barra de pesquisa.
 *
 * São dezenas de tipos cadastrados, então a lista pura de checkboxes obrigava o
 * usuário a rolar caçando o nome. Aqui a busca filtra a lista, mas as opções
 * continuam visíveis (nada de dropdown que esconde o catálogo) e o que já está
 * marcado aparece como chip acima da busca — inclusive quando o filtro atual
 * esconderia a linha correspondente.
 */
export function ExpenseTypePicker({
  options,
  selected,
  onToggle,
  onClear,
  emptyMessage = "Nenhum tipo de despesa cadastrado.",
  idPrefix,
}: ExpenseTypePickerProps) {
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const term = normalize(query);
    if (!term) return options;
    return options.filter((o) => normalize(o.name).includes(term));
  }, [options, query]);

  // Chips do que está marcado, na ordem do catálogo.
  const selectedOptions = useMemo(
    () => options.filter((o) => selected.has(o.id)),
    [options, selected],
  );

  if (options.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  // Enter na busca com um único resultado marca esse resultado. O
  // preventDefault é obrigatório: o cadastro de fornecedor roda dentro de um
  // <form>, e sem ele o Enter enviaria o formulário.
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (visible.length === 1) {
      onToggle(visible[0].id);
      setQuery("");
    }
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          id={`${idPrefix}-expense-type-search`}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Buscar tipo de despesa..."
          aria-label="Buscar tipo de despesa"
          className="w-full rounded-md border bg-background py-2 pl-9 pr-9 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Limpar busca"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {selected.size === 0
            ? `${options.length} ${options.length === 1 ? "tipo disponível" : "tipos disponíveis"}`
            : `${selected.size} de ${options.length} selecionado${selected.size === 1 ? "" : "s"}`}
          {query && ` · ${visible.length} no filtro`}
        </span>
        {onClear && selected.size > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="font-medium text-primary hover:underline"
          >
            Limpar seleção
          </button>
        )}
      </div>

      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 rounded-md border border-dashed bg-muted/30 p-2">
          {selectedOptions.map((o) => (
            <span
              key={o.id}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
            >
              <Tags className="h-3 w-3" />
              {o.name}
              <button
                type="button"
                onClick={() => onToggle(o.id)}
                aria-label={`Remover ${o.name}`}
                className="rounded-full p-0.5 hover:bg-primary/20"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
          Nenhum tipo de despesa encontrado para “{query}”.
        </p>
      ) : (
        <div className="max-h-64 overflow-y-auto rounded-md border p-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {visible.map((o) => {
              const checked = selected.has(o.id);
              return (
                <label
                  key={o.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/40 ${
                    checked ? "border-primary/40 bg-primary/5" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(o.id)}
                    className="h-4 w-4"
                  />
                  <span>{o.name}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
