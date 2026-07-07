"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";

import {
  getBudgetLine,
  saveBudgetLine,
  type BudgetMonth,
} from "@/lib/ctrl/actions/budget-editor";

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const INPUT =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

interface Option {
  id: string;
  name: string;
}

// Aceita "1.234,56", "1234,56", "1234.56", "250". Sinal ignorado (valor absoluto).
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

type Row = { month: number; amount: string; realized: string };

interface Props {
  sectors: Option[];
  expenseTypes: Option[];
  defaultYear: number;
}

export function BudgetLineEditor({ sectors, expenseTypes, defaultYear }: Props) {
  const router = useRouter();
  const [year, setYear] = useState(defaultYear);
  const [sectorId, setSectorId] = useState("");
  const [expenseTypeId, setExpenseTypeId] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const load = useCallback(async (s: string, t: string, y: number) => {
    if (!s || !t) {
      setRows(null);
      return;
    }
    setLoading(true);
    setFeedback(null);
    const res = await getBudgetLine(s, t, y);
    setLoading(false);
    if ("error" in res) {
      setFeedback({ ok: false, msg: res.error });
      setRows(null);
      return;
    }
    setRows(
      res.months.map((m) => ({
        month: m.month,
        amount: brFmt(m.amount),
        realized: brFmt(m.realized),
      })),
    );
  }, []);

  useEffect(() => {
    load(sectorId, expenseTypeId, year);
  }, [sectorId, expenseTypeId, year, load]);

  function updateCell(idx: number, field: "amount" | "realized", value: string) {
    setRows((prev) => (prev ? prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)) : prev));
  }

  const totalOrcado = rows ? rows.reduce((s, r) => s + parseNum(r.amount), 0) : 0;
  const totalRealizado = rows ? rows.reduce((s, r) => s + parseNum(r.realized), 0) : 0;

  async function handleSave() {
    if (!rows || !sectorId || !expenseTypeId) return;
    setSaving(true);
    setFeedback(null);
    const months: BudgetMonth[] = rows.map((r) => ({
      month: r.month,
      amount: parseNum(r.amount),
      realized: parseNum(r.realized),
    }));
    const res = await saveBudgetLine(sectorId, expenseTypeId, year, months);
    setSaving(false);
    if ("error" in res) {
      setFeedback({ ok: false, msg: res.error });
      return;
    }
    setFeedback({ ok: true, msg: "Orçamento salvo." });
    router.refresh();
  }

  const years = [defaultYear - 1, defaultYear, defaultYear + 1];
  const ready = Boolean(sectorId && expenseTypeId);

  return (
    <div className="space-y-5">
      {/* Seletores */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-4">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-muted-foreground">Ano</label>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={INPUT}>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1 min-w-[180px]">
          <label className="block text-xs font-medium text-muted-foreground">Setor</label>
          <select value={sectorId} onChange={(e) => setSectorId(e.target.value)} className={INPUT}>
            <option value="">Selecione…</option>
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1 min-w-[220px]">
          <label className="block text-xs font-medium text-muted-foreground">Tipo de despesa</label>
          <select value={expenseTypeId} onChange={(e) => setExpenseTypeId(e.target.value)} className={INPUT}>
            <option value="">Selecione…</option>
            {expenseTypes.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
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

      {!ready ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          Selecione o ano, o setor e o tipo de despesa para editar os 12 meses.
        </div>
      ) : loading ? (
        <div className="rounded-lg border p-10 text-center text-sm text-muted-foreground">Carregando…</div>
      ) : rows ? (
        <div className="space-y-4">
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Mês</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Orçado</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Realizado</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r, idx) => (
                  <tr key={r.month}>
                    <td className="px-4 py-2 font-medium whitespace-nowrap">{MONTHS[r.month - 1]}</td>
                    <td className="px-2 py-1.5">
                      <input
                        inputMode="decimal"
                        value={r.amount}
                        onChange={(e) => updateCell(idx, "amount", e.target.value)}
                        placeholder="0,00"
                        disabled={saving}
                        className={INPUT + " text-right"}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        inputMode="decimal"
                        value={r.realized}
                        onChange={(e) => updateCell(idx, "realized", e.target.value)}
                        placeholder="0,00"
                        disabled={saving}
                        className={INPUT + " text-right"}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/20 font-semibold">
                  <td className="px-4 py-2.5">Total</td>
                  <td className="px-4 py-2.5 text-right">{brTotal(totalOrcado)}</td>
                  <td className="px-4 py-2.5 text-right">{brTotal(totalRealizado)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
            >
              <Save className="h-4 w-4" />
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
