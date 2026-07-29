"use client";

import { useState, useTransition } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";

import {
  deleteIndiceYear,
  getIndices,
  upsertIndiceYear,
} from "@/lib/orcamento/actions/indices";
import {
  INDICES,
  formatIndice,
  indiceToInput,
  parseBrNumber,
  type IndiceKey,
  type IndiceValues,
  type IndiceYear,
} from "@/lib/orcamento/indices";
import { cn } from "@/lib/utils";

const INPUT_CLS =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
const BTN_PRIMARY =
  "inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors";
const BTN_GHOST =
  "inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors";

type ValueInputs = Record<IndiceKey, string>;

// Derivado do catálogo para não precisar listar cada chave à mão.
const EMPTY_INPUTS: ValueInputs = Object.fromEntries(
  INDICES.map((m) => [m.key, ""]),
) as ValueInputs;

interface Props {
  initialItems: IndiceYear[];
}

export function IndicesManager({ initialItems }: Props) {
  const [items, setItems] = useState<IndiceYear[]>(initialItems);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  // Formulário de novo ano.
  const suggestedYear =
    (items.length > 0 ? Math.max(...items.map((i) => i.year)) : new Date().getFullYear()) + 1;
  const [newYear, setNewYear] = useState<string>(String(suggestedYear));
  const [newValues, setNewValues] = useState<ValueInputs>(EMPTY_INPUTS);

  // Edição inline.
  const [editingYear, setEditingYear] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<ValueInputs>(EMPTY_INPUTS);

  async function reload() {
    const res = await getIndices();
    if (!res?.error && res.items) setItems(res.items);
  }

  function collect(inputs: ValueInputs): { values?: IndiceValues; error?: string } {
    const parsed = {} as IndiceValues;
    for (const meta of INDICES) {
      const p = parseBrNumber(inputs[meta.key] ?? "");
      if (p != null && Number.isNaN(p)) return { error: `Valor inválido em ${meta.label}.` };
      parsed[meta.key] = p;
    }
    return { values: parsed };
  }

  function run(
    action: () => Promise<{ error?: string; ok?: true }>,
    successMsg: string,
    onDone?: () => void,
  ) {
    setFeedback(null);
    startTransition(async () => {
      const res = await action();
      if (res?.error) {
        setFeedback({ ok: false, msg: res.error });
        return;
      }
      setFeedback({ ok: true, msg: successMsg });
      onDone?.();
      await reload();
    });
  }

  function handleAdd() {
    const year = Number(newYear);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      setFeedback({ ok: false, msg: "Informe um ano válido (2000–2100)." });
      return;
    }
    if (items.some((i) => i.year === year)) {
      setFeedback({ ok: false, msg: `O ano ${year} já está cadastrado — edite a linha existente.` });
      return;
    }
    const { values, error } = collect(newValues);
    if (error || !values) {
      setFeedback({ ok: false, msg: error ?? "Valores inválidos." });
      return;
    }
    run(() => upsertIndiceYear(year, values), `Índices de ${year} salvos.`, () => {
      setNewValues(EMPTY_INPUTS);
      setNewYear(String(year + 1));
    });
  }

  function startEdit(row: IndiceYear) {
    setEditingYear(row.year);
    setEditValues(
      Object.fromEntries(
        INDICES.map((m) => [m.key, indiceToInput(row[m.key])]),
      ) as ValueInputs,
    );
    setFeedback(null);
  }

  function handleSaveEdit(year: number) {
    const { values, error } = collect(editValues);
    if (error || !values) {
      setFeedback({ ok: false, msg: error ?? "Valores inválidos." });
      return;
    }
    run(() => upsertIndiceYear(year, values), `Índices de ${year} atualizados.`, () =>
      setEditingYear(null),
    );
  }

  function handleDelete(year: number) {
    if (!window.confirm(`Excluir os índices de ${year}? Esta ação não pode ser desfeita.`)) return;
    run(() => deleteIndiceYear(year), `Ano ${year} removido.`);
  }

  return (
    <div className="space-y-5">
      {/* Adicionar ano */}
      <div className="rounded-lg border bg-muted/20 p-4">
        <p className="mb-3 text-sm font-medium">Adicionar ano</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-24 space-y-1.5">
            <label className="text-xs text-muted-foreground">Ano</label>
            <input
              value={newYear}
              onChange={(e) => setNewYear(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              disabled={isPending}
              className={INPUT_CLS}
            />
          </div>
          {INDICES.map((meta) => (
            <div key={meta.key} className="w-40 space-y-1.5">
              <label className="text-xs text-muted-foreground">
                {meta.label} {meta.unit === "percent" ? "(%)" : "(R$)"}
              </label>
              <input
                value={newValues[meta.key]}
                onChange={(e) =>
                  setNewValues((v) => ({ ...v, [meta.key]: e.target.value }))
                }
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                placeholder={meta.unit === "percent" ? "0,00" : "0,00"}
                inputMode="decimal"
                disabled={isPending}
                className={INPUT_CLS}
              />
            </div>
          ))}
          <button onClick={handleAdd} disabled={isPending} className={BTN_PRIMARY}>
            <Plus className="h-4 w-4" />
            Adicionar
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={cn(
            "rounded-md px-4 py-2 text-sm",
            feedback.ok
              ? "bg-green-500/10 text-green-700"
              : "bg-destructive/10 text-destructive",
          )}
        >
          {feedback.msg}
        </div>
      )}

      {/* Tabela por ano */}
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          Nenhum ano cadastrado ainda.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Ano</th>
                {INDICES.map((meta) => (
                  <th key={meta.key} className="px-4 py-2.5 font-medium">
                    {meta.label} {meta.unit === "percent" ? "(%)" : "(R$)"}
                  </th>
                ))}
                <th className="px-4 py-2.5 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((row) => {
                const isEditing = editingYear === row.year;
                return (
                  <tr key={row.year} className="align-middle">
                    <td className="px-4 py-3 font-semibold tabular-nums">{row.year}</td>
                    {INDICES.map((meta) =>
                      isEditing ? (
                        <td key={meta.key} className="px-4 py-2">
                          <input
                            value={editValues[meta.key]}
                            onChange={(e) =>
                              setEditValues((v) => ({ ...v, [meta.key]: e.target.value }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveEdit(row.year);
                              if (e.key === "Escape") setEditingYear(null);
                            }}
                            inputMode="decimal"
                            disabled={isPending}
                            className={INPUT_CLS + " max-w-[8rem]"}
                          />
                        </td>
                      ) : (
                        <td key={meta.key} className="px-4 py-3 tabular-nums">
                          {formatIndice(row[meta.key], meta.unit)}
                        </td>
                      ),
                    )}
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {isEditing ? (
                          <>
                            <button
                              onClick={() => handleSaveEdit(row.year)}
                              disabled={isPending}
                              className={BTN_GHOST + " text-green-700"}
                            >
                              <Check className="h-4 w-4" /> Salvar
                            </button>
                            <button
                              onClick={() => setEditingYear(null)}
                              disabled={isPending}
                              className={BTN_GHOST}
                            >
                              <X className="h-4 w-4" /> Cancelar
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => startEdit(row)}
                              disabled={isPending}
                              className={BTN_GHOST}
                            >
                              <Pencil className="h-3.5 w-3.5" /> Editar
                            </button>
                            <button
                              onClick={() => handleDelete(row.year)}
                              disabled={isPending}
                              className={BTN_GHOST + " hover:text-destructive"}
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Excluir
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
