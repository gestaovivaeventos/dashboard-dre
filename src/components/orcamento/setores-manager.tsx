"use client";

import { useEffect, useState, useTransition } from "react";
import { Ban, Check, Copy, Loader2, Pencil, Plus, RotateCcw, X } from "lucide-react";

import type { CompanyBudgetConfig } from "@/lib/orcamento/actions/config";
import {
  cloneSetores,
  createSetor,
  getSetores,
  renameSetor,
  setSetorActive,
  type OrcamentoSetor,
} from "@/lib/orcamento/actions/setores";
import { defaultBudgetYear } from "@/lib/orcamento/years";
import { YearSelect } from "@/components/orcamento/year-select";
import { cn } from "@/lib/utils";

const INPUT_CLS =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
const BTN_PRIMARY =
  "inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors";
const BTN_GHOST =
  "inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors";

interface Props {
  companies: CompanyBudgetConfig[];
}

export function SetoresManager({ companies }: Props) {
  const [companyId, setCompanyId] = useState<string>(companies[0]?.companyId ?? "");
  const [year, setYear] = useState<number>(defaultBudgetYear());
  const [items, setItems] = useState<OrcamentoSetor[]>([]);
  const [orcarPorSetor, setOrcarPorSetor] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cloning, setCloning] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  async function reload(id: string, y: number) {
    if (!id) {
      setItems([]);
      return;
    }
    setLoading(true);
    setLoadError(null);
    const res = await getSetores(id, y);
    setLoading(false);
    if (res?.error) {
      setLoadError(res.error);
      setItems([]);
      return;
    }
    setItems(res.items ?? []);
    setOrcarPorSetor(Boolean(res.orcarPorSetor));
  }

  // Carrega os setores sempre que a empresa ou o ano mudam.
  useEffect(() => {
    void reload(companyId, year);
    setEditingId(null);
    setNewName("");
    setFeedback(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, year]);

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
      await reload(companyId, year);
    });
  }

  function handleCreate() {
    const name = newName.trim();
    if (!name || !companyId) return;
    run(() => createSetor(companyId, year, name), "Setor criado.", () => setNewName(""));
  }

  function handleClone() {
    if (!companyId) return;
    const from = year - 1;
    setCloning(true);
    setFeedback(null);
    startTransition(async () => {
      const res = await cloneSetores(companyId, from, year);
      setCloning(false);
      if (res?.error) {
        setFeedback({ ok: false, msg: res.error });
        return;
      }
      await reload(companyId, year);
      setFeedback({
        ok: true,
        msg: res.copied
          ? `${res.copied} setor(es) copiado(s) de ${from} para ${year}.`
          : `Nada a copiar de ${from} (sem setores ativos ou já cadastrados).`,
      });
    });
  }

  function handleRename(id: string) {
    const name = editName.trim();
    if (!name) return;
    run(() => renameSetor(id, name), "Nome atualizado.", () => {
      setEditingId(null);
      setEditName("");
    });
  }

  function handleToggleActive(setor: OrcamentoSetor) {
    run(
      () => setSetorActive(setor.id, !setor.active),
      setor.active ? "Setor inativado." : "Setor reativado.",
    );
  }

  if (companies.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
        Nenhuma empresa ativa encontrada.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Seletor de empresa + ano + clonar */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64 space-y-1.5">
            <label className="text-sm font-medium">Empresa</label>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className={INPUT_CLS}
            >
              {companies.map((c) => (
                <option key={c.companyId} value={c.companyId}>
                  {c.companyName}
                </option>
              ))}
            </select>
          </div>
          <YearSelect value={year} onChange={setYear} disabled={loading || cloning} />
        </div>
        <button
          type="button"
          onClick={handleClone}
          disabled={loading || cloning || isPending || !companyId}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors"
        >
          {cloning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
          Clonar de {year - 1}
        </button>
      </div>

      {!loading && !orcarPorSetor && companyId && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-2.5 text-sm text-muted-foreground">
          Esta empresa está configurada para orçar <strong>só por categoria</strong> em {year}.
          Você pode pré-cadastrar setores aqui, mas eles só entram no orçamento
          quando <strong>Orçar por setor</strong> estiver ligado para ela neste ano.
        </div>
      )}

      {/* Criar novo setor */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/20 p-4">
        <div className="min-w-[200px] flex-1 space-y-1.5">
          <label className="text-sm font-medium">Novo setor</label>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="Nome do setor"
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
            feedback.ok
              ? "bg-green-500/10 text-green-700"
              : "bg-destructive/10 text-destructive",
          )}
        >
          {feedback.msg}
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border p-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando setores…
        </div>
      ) : loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          Nenhum setor cadastrado para esta empresa em {year}. Cadastre acima ou
          use <strong>Clonar de {year - 1}</strong>.
        </div>
      ) : (
        <div className="rounded-lg border divide-y">
          {items.map((setor) => {
            const isEditing = editingId === setor.id;
            return (
              <div key={setor.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {isEditing ? (
                    <div className="flex flex-1 items-center gap-2">
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRename(setor.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        autoFocus
                        disabled={isPending}
                        className={INPUT_CLS + " max-w-sm"}
                      />
                      <button
                        onClick={() => handleRename(setor.id)}
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
                          !setor.active && "text-muted-foreground line-through",
                        )}
                      >
                        {setor.name}
                      </span>
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold",
                          setor.active
                            ? "bg-green-100 text-green-800"
                            : "bg-gray-100 text-gray-500",
                        )}
                      >
                        {setor.active ? "Ativo" : "Inativo"}
                      </span>
                    </div>
                  )}

                  {!isEditing && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setEditingId(setor.id);
                          setEditName(setor.name);
                        }}
                        disabled={isPending}
                        className={BTN_GHOST}
                      >
                        <Pencil className="h-3.5 w-3.5" /> Renomear
                      </button>
                      <button
                        onClick={() => handleToggleActive(setor)}
                        disabled={isPending}
                        className={BTN_GHOST}
                      >
                        {setor.active ? (
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
