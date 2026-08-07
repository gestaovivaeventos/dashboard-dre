"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";

import {
  listBudgetLines,
  deleteBudgetLine,
  moveBudgetLine,
  type BudgetLineSummary,
} from "@/lib/ctrl/actions/budget-editor";
import { BudgetLineEditor } from "@/components/ctrl/budget-line-editor";

interface Option {
  id: string;
  name: string;
}

const brTotal = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props {
  sectors: Option[];
  expenseTypes: Option[];
  defaultYear: number;
  initialLines: BudgetLineSummary[];
}

export function BudgetLinesManager({ sectors, expenseTypes, defaultYear, initialLines }: Props) {
  const router = useRouter();
  const [year, setYear] = useState(defaultYear);
  const [lines, setLines] = useState<BudgetLineSummary[]>(initialLines);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  // Modais.
  const [editModal, setEditModal] = useState<
    { mode: "new" } | { mode: "edit"; line: BudgetLineSummary } | null
  >(null);
  const [moveModal, setMoveModal] = useState<BudgetLineSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BudgetLineSummary | null>(null);

  const refresh = useCallback(async (y: number) => {
    setLoading(true);
    const res = await listBudgetLines(y);
    setLoading(false);
    if ("error" in res) {
      setFeedback({ ok: false, msg: res.error });
      return;
    }
    setLines(res.lines);
  }, []);

  // initialLines cobre o ano padrão no primeiro render; só refaz o fetch quando o
  // ano muda (evita um fetch redundante e um flash na montagem).
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    refresh(year);
  }, [year, refresh]);

  function notify(msg: string, ok = true) {
    setFeedback({ ok, msg });
    setTimeout(() => setFeedback(null), 5000);
  }

  function handleDelete() {
    if (!deleteTarget) return;
    const t = deleteTarget;
    startTransition(async () => {
      const res = await deleteBudgetLine(t.sector_id, t.expense_type_id, year);
      if ("error" in res) {
        notify(res.error, false);
      } else {
        setDeleteTarget(null);
        notify(`Linha "${t.sector_name} · ${t.expense_type_name}" excluída.`);
        await refresh(year);
        router.refresh();
      }
    });
  }

  const years = [defaultYear - 1, defaultYear, defaultYear + 1];
  const totalOrcado = lines.reduce((s, l) => s + l.orcado, 0);
  const totalRealizado = lines.reduce((s, l) => s + l.realizado, 0);

  return (
    <div className="space-y-5">
      {/* Barra: ano + adicionar */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border bg-muted/20 p-4">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-muted-foreground">Ano</label>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => setEditModal({ mode: "new" })}
          className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
        >
          <Plus className="h-4 w-4" />
          Adicionar linha
        </button>
      </div>

      {feedback && (
        <div
          className={`rounded-md px-4 py-2 text-sm ${
            feedback.ok ? "bg-green-500/10 text-green-700" : "bg-destructive/10 text-destructive"
          }`}
        >
          {feedback.msg}
        </div>
      )}

      {/* Tabela de linhas */}
      {loading ? (
        <div className="rounded-lg border p-10 text-center text-sm text-muted-foreground">Carregando…</div>
      ) : lines.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          Nenhuma linha de orçamento para {year}. Use “Adicionar linha”.
        </div>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                <th className="px-4 py-3">Setor</th>
                <th className="px-4 py-3">Tipo de despesa</th>
                <th className="px-4 py-3 text-right">Orçado</th>
                <th className="px-4 py-3 text-right">Realizado (base)</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {lines.map((l) => (
                <tr key={`${l.sector_id}|${l.expense_type_id}`} className="hover:bg-muted/20">
                  <td className="px-4 py-2.5 font-medium">{l.sector_name}</td>
                  <td className="px-4 py-2.5">{l.expense_type_name}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{brTotal(l.orcado)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    {brTotal(l.realizado)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1.5">
                      <button
                        onClick={() => setEditModal({ mode: "edit", line: l })}
                        className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                        title="Editar os 12 meses"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Editar
                      </button>
                      <button
                        onClick={() => setMoveModal(l)}
                        className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                        title="Mover para outro setor/tipo"
                      >
                        <ArrowLeftRight className="h-3.5 w-3.5" />
                        Mover
                      </button>
                      <button
                        onClick={() => setDeleteTarget(l)}
                        className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/10"
                        title="Excluir a linha inteira"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/20 font-semibold">
                <td className="px-4 py-2.5" colSpan={2}>Total ({lines.length} linha{lines.length === 1 ? "" : "s"})</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{brTotal(totalOrcado)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{brTotal(totalRealizado)}</td>
                <td className="px-4 py-2.5" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        O “Realizado (base)” é o valor histórico que você edita aqui. O consumo das
        requisições de pagamento é somado automaticamente por cima, na tela de Orçamento.
      </p>

      {/* Modal Adicionar/Editar (12 meses) */}
      {editModal && (
        <Modal
          title={
            editModal.mode === "new"
              ? "Adicionar linha de orçamento"
              : `Editar — ${editModal.line.sector_name} · ${editModal.line.expense_type_name}`
          }
          onClose={() => setEditModal(null)}
        >
          <BudgetLineEditor
            sectors={sectors}
            expenseTypes={expenseTypes}
            defaultYear={year}
            controlledYear={year}
            initialSectorId={editModal.mode === "edit" ? editModal.line.sector_id : undefined}
            initialExpenseTypeId={editModal.mode === "edit" ? editModal.line.expense_type_id : undefined}
            lockSelectors={editModal.mode === "edit"}
            onSaved={() => {
              setEditModal(null);
              notify("Orçamento salvo.");
              refresh(year);
            }}
          />
        </Modal>
      )}

      {/* Modal Mover */}
      {moveModal && (
        <MoveModal
          line={moveModal}
          sectors={sectors}
          expenseTypes={expenseTypes}
          onClose={() => setMoveModal(null)}
          onMoved={(msg) => {
            setMoveModal(null);
            notify(msg);
            refresh(year);
            router.refresh();
          }}
          onError={(msg) => notify(msg, false)}
          year={year}
        />
      )}

      {/* Confirmação de exclusão */}
      {deleteTarget && (
        <Modal title="Excluir linha do orçamento" onClose={() => (isPending ? null : setDeleteTarget(null))}>
          <div className="space-y-4">
            <p className="text-sm">
              Excluir a linha <strong>{deleteTarget.sector_name} · {deleteTarget.expense_type_name}</strong> de{" "}
              <strong>{year}</strong>? Isso remove os 12 meses (orçado e realizado-base). As requisições
              já lançadas não são afetadas.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={isPending}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Excluir
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Mover uma linha para outro setor/tipo ─────────────────────────────────────

function MoveModal({
  line,
  sectors,
  expenseTypes,
  year,
  onClose,
  onMoved,
  onError,
}: {
  line: BudgetLineSummary;
  sectors: Option[];
  expenseTypes: Option[];
  year: number;
  onClose: () => void;
  onMoved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [toSector, setToSector] = useState(line.sector_id);
  const [toType, setToType] = useState(line.expense_type_id);
  const [isPending, startTransition] = useTransition();

  const unchanged = toSector === line.sector_id && toType === line.expense_type_id;

  function handleMove() {
    if (unchanged) return;
    startTransition(async () => {
      const res = await moveBudgetLine(
        { sectorId: line.sector_id, expenseTypeId: line.expense_type_id },
        { sectorId: toSector, expenseTypeId: toType },
        year,
      );
      if ("error" in res) {
        onError(res.error);
      } else {
        onMoved(
          res.merged
            ? "Linha movida e somada à linha já existente no destino."
            : "Linha movida com sucesso.",
        );
      }
    });
  }

  const SELECT =
    "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

  return (
    <Modal title="Mover linha do orçamento" onClose={() => (isPending ? null : onClose())}>
      <div className="space-y-4">
        <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Origem: </span>
          <strong>{line.sector_name} · {line.expense_type_name}</strong>
          <span className="text-muted-foreground"> · {year}</span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-muted-foreground">Setor de destino</label>
            <select value={toSector} onChange={(e) => setToSector(e.target.value)} disabled={isPending} className={SELECT}>
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-muted-foreground">Tipo de despesa de destino</label>
            <select value={toType} onChange={(e) => setToType(e.target.value)} disabled={isPending} className={SELECT}>
              {expenseTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Se o destino já tiver uma linha desse setor × tipo, os valores serão{" "}
          <strong>somados</strong> (mês a mês). A origem é removida. As requisições já
          lançadas seguem no setor delas.
        </p>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isPending}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleMove}
            disabled={isPending || unchanged}
            className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            title={unchanged ? "Escolha um destino diferente da origem" : undefined}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />}
            Mover
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Modal genérico ────────────────────────────────────────────────────────────

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="my-10 w-full max-w-2xl rounded-xl border bg-background shadow-lg">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} aria-label="Fechar" className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
