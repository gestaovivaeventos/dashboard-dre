"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Copy, Loader2, Search } from "lucide-react";

import {
  cloneCategoriaMetodo,
  getCategoriaMetodo,
  setCategoriaMetodo,
  type CategoriaMetodoItem,
} from "@/lib/orcamento/actions/categoria-metodo";
import { METODOS, type OrcamentoMetodo } from "@/lib/orcamento/metodos";
import { defaultBudgetYear } from "@/lib/orcamento/years";
import { YearSelect } from "@/components/orcamento/year-select";
import { cn } from "@/lib/utils";

const INPUT_CLS =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

interface Company {
  companyId: string;
  companyName: string;
}

const CORE_METODOS = METODOS.filter((m) => !m.ve);
const VE_METODOS = METODOS.filter((m) => m.ve);

export function CategoriaMetodoManager({
  companies,
  fixedCompanyId,
  fixedYear,
}: {
  companies: Company[];
  /** Quando definido, empresa e ano vêm da rota (workspace) — sem seletores. */
  fixedCompanyId?: string;
  fixedYear?: number;
}) {
  const [companyId, setCompanyId] = useState<string>(fixedCompanyId ?? companies[0]?.companyId ?? "");
  const [year, setYear] = useState<number>(fixedYear ?? defaultBudgetYear());
  const [items, setItems] = useState<CategoriaMetodoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [cloning, setCloning] = useState(false);
  const [, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [search, setSearch] = useState("");

  async function reload(id: string, y: number) {
    if (!id) {
      setItems([]);
      return;
    }
    setLoading(true);
    setLoadError(null);
    setNeedsMigration(false);
    const res = await getCategoriaMetodo(id, y);
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
    setItems(res.items ?? []);
  }

  useEffect(() => {
    void reload(companyId, year);
    setSearch("");
    setFeedback(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, year]);

  function handleClone() {
    if (!companyId) return;
    const from = year - 1;
    setCloning(true);
    setFeedback(null);
    startTransition(async () => {
      const res = await cloneCategoriaMetodo(companyId, from, year);
      setCloning(false);
      if (res?.error) {
        setFeedback({ ok: false, msg: res.error });
        return;
      }
      await reload(companyId, year);
      setFeedback({
        ok: true,
        msg: res.copied
          ? `${res.copied} vínculo(s) copiado(s) de ${from} para ${year}.`
          : `Nada a copiar de ${from} (sem vínculos ou já preenchido).`,
      });
    });
  }

  function handleChange(item: CategoriaMetodoItem, next: OrcamentoMetodo | null) {
    const previous = item.metodo;
    setSavingCode(item.categoryCode);
    setFeedback(null);
    // Otimista.
    setItems((prev) =>
      prev.map((r) =>
        r.categoryCode === item.categoryCode ? { ...r, metodo: next } : r,
      ),
    );
    startTransition(async () => {
      const res = await setCategoriaMetodo(
        companyId,
        year,
        item.categoryCode,
        item.categoryName,
        next,
      );
      setSavingCode(null);
      if (res?.error) {
        setItems((prev) =>
          prev.map((r) =>
            r.categoryCode === item.categoryCode ? { ...r, metodo: previous } : r,
          ),
        );
        setFeedback({ ok: false, msg: res.error });
      }
    });
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.categoryName.toLowerCase().includes(q) ||
        i.categoryCode.toLowerCase().includes(q) ||
        i.dreLineCode.toLowerCase().includes(q) ||
        i.dreLineName.toLowerCase().includes(q),
    );
  }, [items, search]);

  const definedCount = items.filter((i) => i.metodo != null).length;

  if (companies.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
        Nenhuma empresa ativa encontrada.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Seletor de empresa + ano + clonar + busca. No workspace, empresa e ano
          vêm da rota (fixos) — os seletores não aparecem. */}
      <div className="flex flex-wrap items-end gap-3">
        {!fixedCompanyId && (
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
        )}
        {!fixedYear && <YearSelect value={year} onChange={setYear} disabled={loading || cloning} />}
        <button
          type="button"
          onClick={handleClone}
          disabled={loading || cloning || !companyId}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors"
        >
          {cloning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
          Clonar de {year - 1}
        </button>
        <div className="min-w-[220px] flex-1 space-y-1.5">
          <label className="text-sm font-medium">Buscar categoria</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nome, código ou linha DRE"
              className={INPUT_CLS + " pl-9"}
            />
          </div>
        </div>
      </div>

      {feedback && !feedback.ok && (
        <div className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {feedback.msg}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border p-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando categorias…
        </div>
      ) : needsMigration ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium">Migration pendente</p>
          <p className="mt-1 text-muted-foreground">
            Rode o <code className="rounded bg-muted px-1 py-0.5">db push</code> da migration{" "}
            <code className="rounded bg-muted px-1 py-0.5">
              20260727170000_orcamento_categoria_metodo
            </code>{" "}
            para habilitar esta tela.
          </p>
        </div>
      ) : loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          Nenhuma categoria de despesa mapeada para esta empresa.
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {definedCount} de {items.length} categorias com método definido.
          </p>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Categoria</th>
                  <th className="px-4 py-2.5 font-medium">Linha DRE</th>
                  <th className="px-4 py-2.5 font-medium">Método de orçamento</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((item) => (
                  <tr key={item.categoryCode}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{item.categoryName}</div>
                      <div className="text-xs text-muted-foreground">{item.categoryCode}</div>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      <span className="tabular-nums">{item.dreLineCode}</span> · {item.dreLineName}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <select
                          value={item.metodo ?? ""}
                          disabled={savingCode === item.categoryCode}
                          onChange={(e) =>
                            handleChange(
                              item,
                              e.target.value === ""
                                ? null
                                : (e.target.value as OrcamentoMetodo),
                            )
                          }
                          className={cn(
                            INPUT_CLS,
                            "max-w-xs",
                            item.metodo == null && "text-muted-foreground",
                          )}
                        >
                          <option value="">— não orçar</option>
                          <optgroup label="Principais">
                            {CORE_METODOS.map((m) => (
                              <option key={m.key} value={m.key}>
                                {m.label}
                              </option>
                            ))}
                          </optgroup>
                          <optgroup label="Viva Eventos (VE)">
                            {VE_METODOS.map((m) => (
                              <option key={m.key} value={m.key}>
                                {m.label}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                        {savingCode === item.categoryCode && (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      Nenhuma categoria encontrada para “{search}”.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
