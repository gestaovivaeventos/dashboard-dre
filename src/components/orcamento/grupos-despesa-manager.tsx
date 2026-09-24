"use client";

import { useEffect, useState, useTransition } from "react";
import { Ban, Check, Loader2, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";

import {
  createGrupoDespesa,
  deleteGrupoDespesa,
  getGruposDespesa,
  renameGrupoDespesa,
  setGrupoDespesaActive,
  type GrupoDespesa,
} from "@/lib/orcamento/actions/grupos";
import { cn } from "@/lib/utils";

const INPUT_CLS =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
const BTN_PRIMARY =
  "inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors";
const BTN_GHOST =
  "inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors";

interface Props {
  companyId: string;
  /** Só para o texto da tela — o cadastro NÃO é por ano. */
  year: number;
}

/**
 * Cadastro dos grupos de despesa da empresa. É o subnível que a Prévia mostra
 * abaixo da categoria e que a entrevista pergunta ao gestor a cada despesa
 * nova.
 *
 * O cadastro é por EMPRESA e não por ano — por isso não há seletor de ano nem
 * "clonar do ano anterior" como no de setores. A tela diz isso em voz alta,
 * senão o admin cadastra tudo de novo em janeiro.
 */
export function GruposDespesaManager({ companyId, year }: Props) {
  const [items, setItems] = useState<GrupoDespesa[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  async function reload() {
    if (!companyId) {
      setItems([]);
      return;
    }
    setLoading(true);
    setLoadError(null);
    const res = await getGruposDespesa(companyId);
    setLoading(false);
    if (res?.needsMigration) {
      setNeedsMigration(true);
      setItems([]);
      return;
    }
    if (res?.error) {
      setLoadError(res.error);
      setItems([]);
      return;
    }
    setNeedsMigration(false);
    setItems(res.items ?? []);
  }

  useEffect(() => {
    void reload();
    setEditingId(null);
    setNewName("");
    setFeedback(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

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

  function handleCreate() {
    const name = newName.trim();
    if (!name || !companyId) return;
    run(() => createGrupoDespesa(companyId, name), "Grupo criado.", () => setNewName(""));
  }

  function handleRename(id: string) {
    const name = editName.trim();
    if (!name) return;
    run(() => renameGrupoDespesa(id, name), "Grupo renomeado.", () => setEditingId(null));
  }

  function handleToggleActive(grupo: GrupoDespesa) {
    run(
      () => setGrupoDespesaActive(grupo.id, !grupo.active),
      grupo.active ? "Grupo inativado." : "Grupo reativado.",
    );
  }

  function handleDelete(grupo: GrupoDespesa) {
    // O banco recusa (FK RESTRICT) um grupo em uso; a tela nem oferece o botão
    // nesse caso, mas a confirmação continua valendo para o que é excluível.
    if (!window.confirm(`Excluir o grupo "${grupo.name}"? Esta ação não pode ser desfeita.`)) {
      return;
    }
    run(() => deleteGrupoDespesa(grupo.id), "Grupo excluído.");
  }

  if (needsMigration) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
        <p className="font-medium">Migration pendente</p>
        <p className="mt-1 text-muted-foreground">
          A tabela de grupos de despesa ainda não foi aplicada no banco.
        </p>
      </div>
    );
  }

  const ativos = items.filter((g) => g.active).length;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
        O grupo é o nível entre a categoria e a despesa — <strong>Softwares</strong> ›{" "}
        <strong>Design</strong> › <em>Figma</em>. É ele que a Prévia abre abaixo de cada categoria
        e que a entrevista pergunta ao gestor a cada despesa nova. O cadastro vale para a empresa
        inteira e <strong>atravessa os anos</strong>: o que você cadastrar aqui continua valendo em{" "}
        {year + 1}.
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/20 p-4">
        <div className="min-w-[200px] flex-1 space-y-1.5">
          <label className="text-sm font-medium">Novo grupo</label>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="Nome do grupo"
            disabled={isPending || !companyId}
            className={INPUT_CLS}
          />
        </div>
        <button
          onClick={handleCreate}
          disabled={isPending || !newName.trim() || !companyId}
          className={BTN_PRIMARY}
        >
          <Plus className="h-4 w-4" />
          Adicionar
        </button>
      </div>

      {feedback && (
        <div
          className={cn(
            "rounded-md px-4 py-2 text-sm",
            feedback.ok ? "bg-green-500/10 text-green-700" : "bg-destructive/10 text-destructive",
          )}
        >
          {feedback.msg}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border p-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando grupos…
        </div>
      ) : loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          Nenhum grupo cadastrado para esta empresa. Cadastre acima — sem grupo, toda despesa cai
          em <strong>Sem grupo</strong> na Prévia.
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {ativos} ativo(s) de {items.length}.
          </p>
          <div className="divide-y rounded-lg border">
            {items.map((grupo) => {
              const isEditing = editingId === grupo.id;
              return (
                <div key={grupo.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    {isEditing ? (
                      <div className="flex flex-1 items-center gap-2">
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRename(grupo.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          autoFocus
                          disabled={isPending}
                          className={INPUT_CLS + " max-w-sm"}
                        />
                        <button
                          onClick={() => handleRename(grupo.id)}
                          disabled={isPending || !editName.trim()}
                          className={BTN_GHOST + " text-green-700"}
                        >
                          <Check className="h-4 w-4" /> Salvar
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          disabled={isPending}
                          className={BTN_GHOST}
                        >
                          <X className="h-4 w-4" /> Cancelar
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2.5">
                        <span
                          className={cn(
                            "font-medium",
                            !grupo.active && "text-muted-foreground line-through",
                          )}
                        >
                          {grupo.name}
                        </span>
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold",
                            grupo.active
                              ? "bg-green-100 text-green-800"
                              : "bg-gray-100 text-gray-500",
                          )}
                        >
                          {grupo.active ? "Ativo" : "Inativo"}
                        </span>
                        {grupo.emUso > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {grupo.emUso} despesa(s) usando
                          </span>
                        )}
                      </div>
                    )}

                    {!isEditing && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setEditingId(grupo.id);
                            setEditName(grupo.name);
                          }}
                          disabled={isPending}
                          className={BTN_GHOST}
                        >
                          <Pencil className="h-3.5 w-3.5" /> Renomear
                        </button>
                        <button
                          onClick={() => handleToggleActive(grupo)}
                          disabled={isPending}
                          className={BTN_GHOST}
                        >
                          {grupo.active ? (
                            <>
                              <Ban className="h-3.5 w-3.5" /> Inativar
                            </>
                          ) : (
                            <>
                              <RotateCcw className="h-3.5 w-3.5" /> Reativar
                            </>
                          )}
                        </button>
                        {/* Excluir só existe enquanto ninguém usa: depois disso
                            o caminho é inativar, e o banco recusaria de todo
                            jeito (FK RESTRICT). */}
                        {grupo.emUso === 0 && (
                          <button
                            onClick={() => handleDelete(grupo)}
                            disabled={isPending}
                            className={BTN_GHOST + " hover:text-destructive"}
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Excluir
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
