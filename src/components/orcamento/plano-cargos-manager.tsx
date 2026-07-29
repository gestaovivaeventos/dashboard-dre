"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Ban,
  Check,
  Copy,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";

import {
  cloneCargos,
  createCargo,
  createNivel,
  deleteNivel,
  getCargos,
  renameCargo,
  setCargoActive,
  updateNivel,
  type CargoNivel,
  type CargoWithNiveis,
} from "@/lib/orcamento/actions/cargos";
import { getSetores } from "@/lib/orcamento/actions/setores";
import { formatBRL, numberToInput, parseBrNumber } from "@/lib/orcamento/format";
import { defaultBudgetYear } from "@/lib/orcamento/years";
import { YearSelect } from "@/components/orcamento/year-select";
import { cn } from "@/lib/utils";

const INPUT_CLS =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
const BTN_PRIMARY =
  "inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors";
const BTN_GHOST =
  "inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors";

interface Company {
  companyId: string;
  companyName: string;
}

interface NivelDraft {
  name: string;
  salario: string;
}

const EMPTY_DRAFT: NivelDraft = { name: "", salario: "" };

/** Interpreta o input de salário. Retorna number válido ou null (inválido/vazio). */
function readSalario(input: string): number | null {
  const v = parseBrNumber(input);
  if (v == null || Number.isNaN(v)) return null;
  return v;
}

export function PlanoCargosManager({ companies }: { companies: Company[] }) {
  const [companyId, setCompanyId] = useState<string>(companies[0]?.companyId ?? "");
  const [year, setYear] = useState<number>(defaultBudgetYear());
  const [orcarPorSetor, setOrcarPorSetor] = useState(false);
  const [setores, setSetores] = useState<{ id: string; name: string }[]>([]);
  const [setorId, setSetorId] = useState<string | null>(null);
  const [cargos, setCargos] = useState<CargoWithNiveis[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const [newCargoName, setNewCargoName] = useState("");
  const [editingCargoId, setEditingCargoId] = useState<string | null>(null);
  const [editCargoName, setEditCargoName] = useState("");

  // Rascunhos de "novo nível" por cargo.
  const [nivelDrafts, setNivelDrafts] = useState<Record<string, NivelDraft>>({});
  // Edição de nível.
  const [editingNivelId, setEditingNivelId] = useState<string | null>(null);
  const [editNivel, setEditNivel] = useState<NivelDraft>(EMPTY_DRAFT);

  async function reload(id: string, y: number, sid: string | null) {
    if (!id) {
      setCargos([]);
      return;
    }
    setLoading(true);
    setLoadError(null);
    setNeedsMigration(false);
    const res = await getCargos(id, y, sid);
    setLoading(false);
    if (res?.needsMigration) {
      setNeedsMigration(true);
      setCargos([]);
      return;
    }
    if (res?.error) {
      setLoadError(res.error);
      setCargos([]);
      return;
    }
    setCargos(res.items ?? []);
  }

  async function init(id: string, y: number) {
    setEditingCargoId(null);
    setEditingNivelId(null);
    setNewCargoName("");
    setNivelDrafts({});
    setFeedback(null);
    if (!id) {
      setCargos([]);
      return;
    }
    setLoading(true);
    const res = await getSetores(id, y);
    const isPorSetor = Boolean(res?.orcarPorSetor);
    const list = (res?.items ?? []).filter((s) => s.active).map((s) => ({ id: s.id, name: s.name }));
    setOrcarPorSetor(isPorSetor);
    setSetores(list);
    const defaultSetor = isPorSetor ? list[0]?.id ?? null : null;
    setSetorId(defaultSetor);
    if (isPorSetor && !defaultSetor) {
      // Orça por setor mas não há setores: nada a listar até cadastrá-los.
      setCargos([]);
      setLoading(false);
      return;
    }
    await reload(id, y, defaultSetor);
  }

  useEffect(() => {
    void init(companyId, year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, year]);

  function handleSetorChange(sid: string) {
    setSetorId(sid);
    setEditingCargoId(null);
    setEditingNivelId(null);
    setNewCargoName("");
    setNivelDrafts({});
    setFeedback(null);
    void reload(companyId, year, sid);
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
      await reload(companyId, year, setorId);
    });
  }

  function handleClone() {
    if (!companyId) return;
    const from = year - 1;
    setCloning(true);
    setFeedback(null);
    startTransition(async () => {
      const res = await cloneCargos(companyId, from, year);
      setCloning(false);
      if (res?.error) {
        setFeedback({ ok: false, msg: res.error });
        return;
      }
      await reload(companyId, year, setorId);
      setFeedback({
        ok: true,
        msg: res.copied
          ? `${res.copied} cargo(s) copiado(s) de ${from} para ${year} (com níveis e salários).`
          : `Nada a copiar de ${from} (sem cargos ativos ou já cadastrados).`,
      });
    });
  }

  function setDraft(cargoId: string, patch: Partial<NivelDraft>) {
    setNivelDrafts((prev) => ({
      ...prev,
      [cargoId]: { ...(prev[cargoId] ?? EMPTY_DRAFT), ...patch },
    }));
  }

  // ── Cargo ──
  function handleAddCargo() {
    const name = newCargoName.trim();
    if (!name || !companyId) return;
    run(() => createCargo(companyId, year, name, setorId), "Cargo criado.", () => setNewCargoName(""));
  }

  function handleRenameCargo(id: string) {
    const name = editCargoName.trim();
    if (!name) return;
    run(() => renameCargo(id, name), "Cargo renomeado.", () => setEditingCargoId(null));
  }

  function handleToggleCargo(cargo: CargoWithNiveis) {
    run(
      () => setCargoActive(cargo.id, !cargo.active),
      cargo.active ? "Cargo inativado." : "Cargo reativado.",
    );
  }

  // ── Nível ──
  function handleAddNivel(cargoId: string) {
    const draft = nivelDrafts[cargoId] ?? EMPTY_DRAFT;
    const name = draft.name.trim();
    if (!name) {
      setFeedback({ ok: false, msg: "Informe o nome do nível." });
      return;
    }
    const salario = readSalario(draft.salario);
    if (salario == null) {
      setFeedback({ ok: false, msg: "Informe um salário válido para o nível." });
      return;
    }
    run(() => createNivel(cargoId, name, salario), "Nível adicionado.", () =>
      setDraft(cargoId, { name: "", salario: "" }),
    );
  }

  function startEditNivel(nivel: CargoNivel) {
    setEditingNivelId(nivel.id);
    setEditNivel({ name: nivel.name, salario: numberToInput(nivel.salario) });
    setFeedback(null);
  }

  function handleSaveNivel(id: string) {
    const name = editNivel.name.trim();
    if (!name) {
      setFeedback({ ok: false, msg: "Informe o nome do nível." });
      return;
    }
    const salario = readSalario(editNivel.salario);
    if (salario == null) {
      setFeedback({ ok: false, msg: "Informe um salário válido para o nível." });
      return;
    }
    run(() => updateNivel(id, name, salario), "Nível atualizado.", () =>
      setEditingNivelId(null),
    );
  }

  function handleDeleteNivel(nivel: CargoNivel) {
    if (!window.confirm(`Excluir o nível "${nivel.name}"?`)) return;
    run(() => deleteNivel(nivel.id), "Nível removido.");
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
          {orcarPorSetor && setores.length > 0 && (
            <div className="w-56 space-y-1.5">
              <label className="text-sm font-medium">Setor</label>
              <select
                value={setorId ?? ""}
                onChange={(e) => handleSetorChange(e.target.value)}
                disabled={loading || cloning}
                className={INPUT_CLS}
              >
                {setores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
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

      {orcarPorSetor && setores.length === 0 ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm text-muted-foreground">
          Esta empresa orça <strong>por setor</strong> em {year}, mas não há setores cadastrados.
          Cadastre-os em <strong>Configurações → Setores</strong> para montar o plano de cargos de
          cada setor.
        </div>
      ) : (
        /* Novo cargo */
        <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/20 p-4">
          <div className="min-w-[220px] flex-1 space-y-1.5">
            <label className="text-sm font-medium">
              Novo cargo
              {orcarPorSetor && setorId && (
                <span className="ml-1 font-normal text-muted-foreground">
                  · setor {setores.find((s) => s.id === setorId)?.name}
                </span>
              )}
            </label>
            <input
              value={newCargoName}
              onChange={(e) => setNewCargoName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddCargo()}
              placeholder="Ex.: Analista Financeiro"
              disabled={isPending || !companyId}
              className={INPUT_CLS}
            />
          </div>
          <button
            onClick={handleAddCargo}
            disabled={isPending || !newCargoName.trim() || !companyId}
            className={BTN_PRIMARY}
          >
            <Plus className="h-4 w-4" />
            Adicionar cargo
          </button>
        </div>
      )}

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

      {/* Lista de cargos */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border p-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando cargos…
        </div>
      ) : needsMigration ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium">Migration pendente</p>
          <p className="mt-1 text-muted-foreground">
            Rode o <code className="rounded bg-muted px-1 py-0.5">db push</code> da migration{" "}
            <code className="rounded bg-muted px-1 py-0.5">20260727160000_orcamento_cargos</code>{" "}
            para habilitar esta tela.
          </p>
        </div>
      ) : loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : cargos.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          Nenhum cargo cadastrado para esta empresa em {year}. Cadastre acima ou
          use <strong>Clonar de {year - 1}</strong>.
        </div>
      ) : (
        <div className="space-y-4">
          {cargos.map((cargo) => {
            const isEditingCargo = editingCargoId === cargo.id;
            const draft = nivelDrafts[cargo.id] ?? EMPTY_DRAFT;
            return (
              <div
                key={cargo.id}
                className={cn(
                  "rounded-lg border",
                  !cargo.active && "opacity-70",
                )}
              >
                {/* Header do cargo */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-4 py-3">
                  {isEditingCargo ? (
                    <div className="flex flex-1 items-center gap-2">
                      <input
                        value={editCargoName}
                        onChange={(e) => setEditCargoName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRenameCargo(cargo.id);
                          if (e.key === "Escape") setEditingCargoId(null);
                        }}
                        autoFocus
                        disabled={isPending}
                        className={INPUT_CLS + " max-w-sm"}
                      />
                      <button
                        onClick={() => handleRenameCargo(cargo.id)}
                        disabled={isPending || !editCargoName.trim()}
                        className={BTN_GHOST + " text-green-700"}
                      >
                        <Check className="h-4 w-4" /> Salvar
                      </button>
                      <button
                        onClick={() => setEditingCargoId(null)}
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
                          "font-semibold",
                          !cargo.active && "text-muted-foreground line-through",
                        )}
                      >
                        {cargo.name}
                      </span>
                      {!cargo.active && (
                        <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
                          Inativo
                        </span>
                      )}
                    </div>
                  )}

                  {!isEditingCargo && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setEditingCargoId(cargo.id);
                          setEditCargoName(cargo.name);
                        }}
                        disabled={isPending}
                        className={BTN_GHOST}
                      >
                        <Pencil className="h-3.5 w-3.5" /> Renomear
                      </button>
                      <button
                        onClick={() => handleToggleCargo(cargo)}
                        disabled={isPending}
                        className={BTN_GHOST}
                      >
                        {cargo.active ? (
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

                {/* Níveis do cargo */}
                <div className="px-4 py-3">
                  {cargo.niveis.length === 0 ? (
                    <p className="mb-3 text-sm text-muted-foreground">
                      Nenhum nível cadastrado. Adicione ao menos um (ex.: Único, ou Jr/Pl/Sr).
                    </p>
                  ) : (
                    <div className="mb-3 overflow-x-auto rounded-md border">
                      <table className="w-full text-sm">
                        <thead className="border-b bg-muted/20 text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2 font-medium">Nível</th>
                            <th className="px-3 py-2 font-medium">Salário-base</th>
                            <th className="px-3 py-2 text-right font-medium">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {cargo.niveis.map((nivel) => {
                            const isEditing = editingNivelId === nivel.id;
                            return (
                              <tr key={nivel.id}>
                                {isEditing ? (
                                  <>
                                    <td className="px-3 py-2">
                                      <input
                                        value={editNivel.name}
                                        onChange={(e) =>
                                          setEditNivel((v) => ({ ...v, name: e.target.value }))
                                        }
                                        disabled={isPending}
                                        className={INPUT_CLS + " max-w-[10rem]"}
                                      />
                                    </td>
                                    <td className="px-3 py-2">
                                      <input
                                        value={editNivel.salario}
                                        onChange={(e) =>
                                          setEditNivel((v) => ({ ...v, salario: e.target.value }))
                                        }
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") handleSaveNivel(nivel.id);
                                          if (e.key === "Escape") setEditingNivelId(null);
                                        }}
                                        inputMode="decimal"
                                        placeholder="0,00"
                                        disabled={isPending}
                                        className={INPUT_CLS + " max-w-[10rem]"}
                                      />
                                    </td>
                                    <td className="px-3 py-2">
                                      <div className="flex items-center justify-end gap-1">
                                        <button
                                          onClick={() => handleSaveNivel(nivel.id)}
                                          disabled={isPending}
                                          className={BTN_GHOST + " text-green-700"}
                                        >
                                          <Check className="h-4 w-4" /> Salvar
                                        </button>
                                        <button
                                          onClick={() => setEditingNivelId(null)}
                                          disabled={isPending}
                                          className={BTN_GHOST}
                                        >
                                          <X className="h-4 w-4" /> Cancelar
                                        </button>
                                      </div>
                                    </td>
                                  </>
                                ) : (
                                  <>
                                    <td className="px-3 py-2.5 font-medium">{nivel.name}</td>
                                    <td className="px-3 py-2.5 tabular-nums">
                                      {formatBRL(nivel.salario)}
                                    </td>
                                    <td className="px-3 py-2">
                                      <div className="flex items-center justify-end gap-1">
                                        <button
                                          onClick={() => startEditNivel(nivel)}
                                          disabled={isPending}
                                          className={BTN_GHOST}
                                        >
                                          <Pencil className="h-3.5 w-3.5" /> Editar
                                        </button>
                                        <button
                                          onClick={() => handleDeleteNivel(nivel)}
                                          disabled={isPending}
                                          className={BTN_GHOST + " hover:text-destructive"}
                                        >
                                          <Trash2 className="h-3.5 w-3.5" /> Excluir
                                        </button>
                                      </div>
                                    </td>
                                  </>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Adicionar nível */}
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="w-40 space-y-1">
                      <label className="text-xs text-muted-foreground">Novo nível</label>
                      <input
                        value={draft.name}
                        onChange={(e) => setDraft(cargo.id, { name: e.target.value })}
                        placeholder="Ex.: Pleno"
                        disabled={isPending}
                        className={INPUT_CLS}
                      />
                    </div>
                    <div className="w-40 space-y-1">
                      <label className="text-xs text-muted-foreground">Salário-base (R$)</label>
                      <input
                        value={draft.salario}
                        onChange={(e) => setDraft(cargo.id, { salario: e.target.value })}
                        onKeyDown={(e) => e.key === "Enter" && handleAddNivel(cargo.id)}
                        placeholder="0,00"
                        inputMode="decimal"
                        disabled={isPending}
                        className={INPUT_CLS}
                      />
                    </div>
                    <button
                      onClick={() => handleAddNivel(cargo.id)}
                      disabled={isPending || !draft.name.trim()}
                      className={BTN_GHOST + " border"}
                    >
                      <Plus className="h-3.5 w-3.5" /> Adicionar nível
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
