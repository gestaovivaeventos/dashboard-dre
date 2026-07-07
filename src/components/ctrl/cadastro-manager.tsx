"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, GitMerge, Pencil, Plus, RotateCcw, X, Ban } from "lucide-react";

import {
  createCadastro,
  renameCadastro,
  setCadastroActive,
  mergeCadastro,
  type CadastroEntity,
  type CadastroItem,
} from "@/lib/ctrl/actions/cadastros";

const INPUT_CLS =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
const BTN_PRIMARY =
  "inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 transition-colors";
const BTN_GHOST =
  "inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors";

interface Labels {
  singular: string; // ex.: "setor"
  plural: string; // ex.: "setores"
}

interface Props {
  entity: CadastroEntity;
  items: CadastroItem[];
  labels: Labels;
}

export function CadastroManager({ entity, items, labels }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  // Criar
  const [newName, setNewName] = useState("");
  // Renomear
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  // Mesclar
  const [mergingId, setMergingId] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");

  function run(
    action: () => Promise<{ error?: string; ok?: true }>,
    successMsg: string,
    onDone?: () => void,
  ) {
    setFeedback(null);
    startTransition(async () => {
      try {
        const res = await action();
        if (res?.error) {
          setFeedback({ ok: false, msg: res.error });
          return;
        }
        setFeedback({ ok: true, msg: successMsg });
        onDone?.();
        router.refresh();
      } catch (e) {
        setFeedback({ ok: false, msg: e instanceof Error ? e.message : "Falha na operação." });
      }
    });
  }

  function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    run(() => createCadastro(entity, name), `${cap(labels.singular)} criado.`, () => setNewName(""));
  }

  function handleRename(id: string) {
    const name = editName.trim();
    if (!name) return;
    run(() => renameCadastro(entity, id, name), "Nome atualizado.", () => {
      setEditingId(null);
      setEditName("");
    });
  }

  function handleToggleActive(item: CadastroItem) {
    run(
      () => setCadastroActive(entity, item.id, !item.active),
      item.active ? `${cap(labels.singular)} inativado.` : `${cap(labels.singular)} reativado.`,
    );
  }

  function handleMerge(sourceId: string) {
    if (!mergeTarget) return;
    run(() => mergeCadastro(entity, sourceId, mergeTarget), "Mesclagem concluída.", () => {
      setMergingId(null);
      setMergeTarget("");
    });
  }

  const activeItems = items.filter((i) => i.active);

  return (
    <div className="space-y-5">
      {/* Criar novo */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/20 p-4">
        <div className="flex-1 min-w-[200px] space-y-1.5">
          <label className="text-sm font-medium">Novo {labels.singular}</label>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder={`Nome do ${labels.singular}`}
            disabled={isPending}
            className={INPUT_CLS}
          />
        </div>
        <button onClick={handleCreate} disabled={isPending || !newName.trim()} className={BTN_PRIMARY}>
          <Plus className="h-4 w-4" />
          Adicionar
        </button>
      </div>

      {feedback && (
        <div
          className={`rounded-md px-4 py-2 text-sm ${
            feedback.ok
              ? "bg-green-500/10 text-green-700"
              : "bg-destructive/10 text-destructive"
          }`}
        >
          {feedback.msg}
        </div>
      )}

      {/* Lista */}
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          Nenhum {labels.singular} cadastrado.
        </div>
      ) : (
        <div className="rounded-lg border divide-y">
          {items.map((item) => {
            const isEditing = editingId === item.id;
            const isMerging = mergingId === item.id;
            // Destinos possíveis de mesclagem: qualquer outro registro ativo.
            const mergeOptions = activeItems.filter((i) => i.id !== item.id);
            return (
              <div key={item.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {isEditing ? (
                    <div className="flex flex-1 items-center gap-2">
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRename(item.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        autoFocus
                        disabled={isPending}
                        className={INPUT_CLS + " max-w-sm"}
                      />
                      <button
                        onClick={() => handleRename(item.id)}
                        disabled={isPending || !editName.trim()}
                        className={BTN_GHOST + " text-green-700"}
                      >
                        <Check className="h-4 w-4" /> Salvar
                      </button>
                      <button onClick={() => setEditingId(null)} disabled={isPending} className={BTN_GHOST}>
                        <X className="h-4 w-4" /> Cancelar
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2.5">
                      <span className={`font-medium ${item.active ? "" : "text-muted-foreground line-through"}`}>
                        {item.name}
                      </span>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                          item.active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {item.active ? "Ativo" : "Inativo"}
                      </span>
                    </div>
                  )}

                  {!isEditing && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setEditingId(item.id);
                          setEditName(item.name);
                          setMergingId(null);
                        }}
                        disabled={isPending}
                        className={BTN_GHOST}
                      >
                        <Pencil className="h-3.5 w-3.5" /> Renomear
                      </button>
                      {item.active && mergeOptions.length > 0 && (
                        <button
                          onClick={() => {
                            setMergingId(isMerging ? null : item.id);
                            setMergeTarget("");
                          }}
                          disabled={isPending}
                          className={BTN_GHOST}
                        >
                          <GitMerge className="h-3.5 w-3.5" /> Mesclar
                        </button>
                      )}
                      <button
                        onClick={() => handleToggleActive(item)}
                        disabled={isPending}
                        className={BTN_GHOST}
                      >
                        {item.active ? (
                          <>
                            <Ban className="h-3.5 w-3.5" /> Inativar
                          </>
                        ) : (
                          <>
                            <RotateCcw className="h-3.5 w-3.5" /> Reativar
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>

                {/* Painel de mesclagem */}
                {isMerging && (
                  <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
                    <p className="text-sm">
                      Transferir todos os lançamentos de <strong>{item.name}</strong> para outro{" "}
                      {labels.singular} e inativar <strong>{item.name}</strong>:
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={mergeTarget}
                        onChange={(e) => setMergeTarget(e.target.value)}
                        disabled={isPending}
                        className={INPUT_CLS + " max-w-xs"}
                      >
                        <option value="">Selecione o {labels.singular} de destino…</option>
                        {mergeOptions.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.name}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleMerge(item.id)}
                        disabled={isPending || !mergeTarget}
                        className={BTN_PRIMARY}
                      >
                        <GitMerge className="h-4 w-4" /> Confirmar mesclagem
                      </button>
                      <button onClick={() => setMergingId(null)} disabled={isPending} className={BTN_GHOST}>
                        Cancelar
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Requisições, orçamento e vínculos passam para o destino. Orçamento não é somado
                      na colisão (prevalece o destino). Esta ação não pode ser desfeita
                      automaticamente.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
