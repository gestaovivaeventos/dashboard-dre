"use client";

import { useEffect, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";

import {
  getEncargosCompanies,
  resetEncargos,
  setEncargos,
  type CompanyEncargos,
} from "@/lib/orcamento/actions/encargos";
import { ENCARGOS, type EncargoValues } from "@/lib/orcamento/encargos";
import { regimeTributarioLabel } from "@/lib/companies/regime-tributario";
import { numberToInput, parseBrNumber } from "@/lib/orcamento/format";
import { defaultBudgetYear } from "@/lib/orcamento/years";
import { YearSelect } from "@/components/orcamento/year-select";
import { cn } from "@/lib/utils";

const CELL =
  "w-full rounded border bg-background px-2 py-1 text-sm text-right tabular-nums outline-none focus:ring-1 focus:ring-ring";

interface Props {
  initialItems: CompanyEncargos[];
  initialYear: number;
}

export function EncargosManager({ initialItems, initialYear }: Props) {
  const [year, setYear] = useState<number>(initialYear || defaultBudgetYear());
  const [rows, setRows] = useState<CompanyEncargos[]>(initialItems);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  async function reload(y: number) {
    setLoading(true);
    const res = await getEncargosCompanies(y);
    setLoading(false);
    if (res?.error) {
      setFeedback({ ok: false, msg: res.error });
      return;
    }
    setRows(res.items ?? []);
  }

  useEffect(() => {
    if (year === initialYear) return;
    setFeedback(null);
    void reload(year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  if (rows.length === 0 && !loading) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
        Nenhuma empresa ativa encontrada.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <YearSelect value={year} onChange={setYear} disabled={loading} />

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

      <div className="rounded-md border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
        Alíquotas em <strong>pontos percentuais</strong> sobre a folha (20 = 20%). Empresas sem
        ajuste próprio exibem o padrão do seu regime tributário e aparecem marcadas como{" "}
        <em>padrão</em> — basta editar para gravar.
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border p-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-[880px] w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <th className="border-r px-3 py-2 text-left">Empresa</th>
                {ENCARGOS.map((e) => (
                  <th key={e.key} className="border-r px-3 py-2 text-right" title={e.hint}>
                    {e.label}
                  </th>
                ))}
                <th className="border-r px-3 py-2 text-right">Total</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <EncargoRow
                  key={row.companyId}
                  row={row}
                  year={year}
                  onSaved={(values) => {
                    setRows((prev) =>
                      prev.map((r) =>
                        r.companyId === row.companyId
                          ? { ...r, values, usandoPadrao: false }
                          : r,
                      ),
                    );
                  }}
                  onReset={() => void reload(year)}
                  onError={(msg) => setFeedback({ ok: false, msg })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function toDraft(values: EncargoValues): Record<string, string> {
  const d: Record<string, string> = {};
  for (const e of ENCARGOS) d[e.key] = numberToInput(values[e.key]);
  return d;
}

function EncargoRow({
  row,
  year,
  onSaved,
  onReset,
  onError,
}: {
  row: CompanyEncargos;
  year: number;
  onSaved: (values: EncargoValues) => void;
  onReset: () => void;
  onError: (msg: string) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() => toDraft(row.values));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // O ano muda embaixo da linha quando o pai recarrega — ressincroniza.
  useEffect(() => {
    setDraft(toDraft(row.values));
    setDirty(false);
  }, [row.values]);

  const total = ENCARGOS.reduce((acc, e) => {
    const v = parseBrNumber(draft[e.key] ?? "");
    return acc + (v == null || Number.isNaN(v) ? 0 : v);
  }, 0);

  async function persist() {
    if (!dirty) return;
    setDirty(false);
    setSaving(true);
    const values = {} as EncargoValues;
    for (const e of ENCARGOS) {
      const v = parseBrNumber(draft[e.key] ?? "");
      values[e.key] = v == null || Number.isNaN(v) ? 0 : v;
    }
    const res = await setEncargos(row.companyId, year, values);
    setSaving(false);
    if (res?.error) {
      onError(res.error);
      return;
    }
    onSaved(values);
  }

  async function handleReset() {
    if (!window.confirm(`Voltar ${row.companyName} ao padrão do regime tributário em ${year}?`)) {
      return;
    }
    setSaving(true);
    const res = await resetEncargos(row.companyId, year);
    setSaving(false);
    if (res?.error) {
      onError(res.error);
      return;
    }
    onReset();
  }

  return (
    <tr className="hover:bg-muted/20">
      <td className="border-r px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{row.companyName}</span>
          <span className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {regimeTributarioLabel(row.regimeTributario)}
          </span>
          {row.usandoPadrao && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              padrão
            </span>
          )}
        </div>
      </td>
      {ENCARGOS.map((e) => (
        <td key={e.key} className="border-r px-2 py-1">
          <input
            value={draft[e.key] ?? ""}
            onChange={(ev) => {
              setDirty(true);
              setDraft((prev) => ({ ...prev, [e.key]: ev.target.value }));
            }}
            onBlur={() => void persist()}
            onFocus={(ev) => {
              const el = ev.target;
              requestAnimationFrame(() => el.select());
            }}
            inputMode="decimal"
            placeholder="0"
            className={cn(CELL, "min-w-[5.5rem]")}
          />
        </td>
      ))}
      <td className="border-r px-3 py-1.5 text-right font-medium tabular-nums">
        {total.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%
      </td>
      <td className="px-2 py-1 text-center">
        {saving ? (
          <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          !row.usandoPadrao && (
            <button
              type="button"
              onClick={() => void handleReset()}
              title="Voltar ao padrão do regime"
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )
        )}
      </td>
    </tr>
  );
}
