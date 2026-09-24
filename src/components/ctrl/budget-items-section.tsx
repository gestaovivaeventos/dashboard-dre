"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";

import {
  deleteBudgetItem,
  listBudgetItems,
  saveBudgetItem,
  type BudgetItem,
} from "@/lib/ctrl/actions/budget-items";

const INPUT =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

// Aceita "1.234,56", "1234,56", "1234.56", "250". Valor absoluto.
function parseNum(raw: string): number {
  const t = (raw ?? "").trim();
  if (!t) return 0;
  const body = t.replace(/[R$\s]/g, "");
  const n = body.includes(",")
    ? Number(body.replace(/\./g, "").replace(",", "."))
    : Number(body);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}
const brFmt = (n: number) =>
  n === 0 ? "" : n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brTotal = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props {
  sectorId: string;
  expenseTypeId: string;
  year: number;
}

export function BudgetItemsSection({ sectorId, expenseTypeId, year }: Props) {
  const [items, setItems] = useState<BudgetItem[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { name: string; amount: string }>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState("");

  const load = useCallback(async () => {
    if (!sectorId || !expenseTypeId) {
      setItems(null);
      return;
    }
    setLoading(true);
    const res = await listBudgetItems(sectorId, expenseTypeId, year);
    setLoading(false);
    if ("error" in res) {
      setFeedback({ ok: false, msg: res.error });
      setItems([]);
      return;
    }
    setItems(res.items);
    setDrafts(
      Object.fromEntries(res.items.map((i) => [i.id, { name: i.name, amount: brFmt(i.amount) }])),
    );
  }, [sectorId, expenseTypeId, year]);

  useEffect(() => {
    load();
  }, [load]);

  async function addItem() {
    if (!newName.trim()) return;
    setBusy(true);
    setFeedback(null);
    const res = await saveBudgetItem({
      sectorId,
      expenseTypeId,
      year,
      name: newName,
      amount: parseNum(newAmount),
    });
    setBusy(false);
    if ("error" in res) {
      setFeedback({ ok: false, msg: res.error });
      return;
    }
    setNewName("");
    setNewAmount("");
    await load();
  }

  async function saveItem(id: string) {
    const d = drafts[id];
    if (!d) return;
    setBusy(true);
    setFeedback(null);
    const res = await saveBudgetItem({
      id,
      sectorId,
      expenseTypeId,
      year,
      name: d.name,
      amount: parseNum(d.amount),
    });
    setBusy(false);
    if ("error" in res) {
      setFeedback({ ok: false, msg: res.error });
      return;
    }
    await load();
  }

  async function removeItem(id: string) {
    setBusy(true);
    setFeedback(null);
    const res = await deleteBudgetItem(id);
    setBusy(false);
    if ("error" in res) {
      setFeedback({ ok: false, msg: res.error });
      return;
    }
    await load();
  }

  const total = (items ?? []).reduce((s, i) => s + i.amount, 0);

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div>
        <h3 className="text-sm font-semibold">Itens de orçamento (rubricas)</h3>
        <p className="text-xs text-muted-foreground">
          Subdivida este tipo em itens (ex.: Alura), cada um com orçado anual próprio. Quando o tipo
          tiver itens, a nova requisição vai <strong>exigir a escolha de um deles</strong> e o
          orçamento é conferido item a item — o estouro de um não afeta os outros.
        </p>
      </div>

      {feedback && (
        <div
          className={`rounded-md px-3 py-2 text-sm ${
            feedback.ok ? "bg-green-500/10 text-green-700" : "bg-destructive/10 text-destructive"
          }`}
        >
          {feedback.msg}
        </div>
      )}

      {loading ? (
        <p className="py-3 text-sm text-muted-foreground">Carregando itens…</p>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2 text-right">Orçado anual</th>
                <th className="px-3 py-2 text-right w-24">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(items ?? []).map((it) => {
                const d = drafts[it.id] ?? { name: it.name, amount: brFmt(it.amount) };
                return (
                  <tr key={it.id}>
                    <td className="px-2 py-1.5">
                      <input
                        value={d.name}
                        onChange={(e) =>
                          setDrafts((p) => ({ ...p, [it.id]: { ...d, name: e.target.value } }))
                        }
                        disabled={busy}
                        className={INPUT}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        inputMode="decimal"
                        value={d.amount}
                        onChange={(e) =>
                          setDrafts((p) => ({ ...p, [it.id]: { ...d, amount: e.target.value } }))
                        }
                        placeholder="0,00"
                        disabled={busy}
                        className={INPUT + " text-right"}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => saveItem(it.id)}
                          disabled={busy}
                          title="Salvar item"
                          className="rounded-md border p-1.5 hover:bg-muted disabled:opacity-50"
                        >
                          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeItem(it.id)}
                          disabled={busy}
                          title="Excluir item"
                          className="rounded-md border p-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {/* Nova linha */}
              <tr className="bg-muted/10">
                <td className="px-2 py-1.5">
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Nome do item (ex.: Alura)"
                    disabled={busy}
                    className={INPUT}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    inputMode="decimal"
                    value={newAmount}
                    onChange={(e) => setNewAmount(e.target.value)}
                    placeholder="0,00"
                    disabled={busy}
                    className={INPUT + " text-right"}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={addItem}
                      disabled={busy || !newName.trim()}
                      className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Adicionar
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
            {(items ?? []).length > 0 && (
              <tfoot>
                <tr className="border-t bg-muted/20 font-semibold">
                  <td className="px-3 py-2">Total dos itens</td>
                  <td className="px-3 py-2 text-right">{brTotal(total)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Os itens são uma camada à parte: não alteram o orçado/realizado por tipo acima nem o
        histórico. Servem só para a verificação da requisição por item.
      </p>
    </div>
  );
}
