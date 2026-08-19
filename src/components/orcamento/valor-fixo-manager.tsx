"use client";

import { useEffect, useMemo, useState, useRef, useTransition } from "react";
import { ChevronDown, ChevronRight, Loader2, Search, TriangleAlert } from "lucide-react";

import {
  getValorFixoCategorias,
  setValorFixoBase,
  setValorFixoIndice,
  setValorFixoMesReajuste,
  type IndiceOption,
  type ValorFixoItem,
} from "@/lib/orcamento/actions/valor-fixo";
import { projetarValorFixoSerie, corrigirValorFixo } from "@/lib/orcamento/valor-fixo-calc";
import { formatBRL, numberToInput, parseBrNumber } from "@/lib/orcamento/format";
import { formatIndice, type IndiceKey } from "@/lib/orcamento/indices";
import { cn } from "@/lib/utils";

const INPUT_CLS =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
const CELL =
  "w-full rounded border bg-background px-2 py-1 text-sm text-right tabular-nums outline-none focus:ring-1 focus:ring-ring disabled:opacity-40 disabled:bg-muted/40";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_LONGO = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** Célula de moeda: "R$ 3.000,00" fora de foco; ao focar, valor cru. */
function CurrencyCell({
  value,
  onChange,
  onBlur,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  className?: string;
}) {
  const [focused, setFocused] = useState(false);
  const num = parseBrNumber(value);
  const display = focused || num == null || Number.isNaN(num) ? value : formatBRL(num);
  return (
    <input
      value={display}
      onChange={(e) => onChange(e.target.value)}
      onFocus={(e) => {
        setFocused(true);
        const el = e.target;
        requestAnimationFrame(() => el.select());
      }}
      onBlur={() => {
        setFocused(false);
        onBlur();
      }}
      inputMode="decimal"
      placeholder="R$ 0,00"
      className={className}
    />
  );
}

// ─── Linha ──────────────────────────────────────────────────────────────────

function ValorFixoRow({
  item,
  indices,
  companyId,
  budgetYear,
  onPatch,
  onError,
}: {
  item: ValorFixoItem;
  indices: IndiceOption[];
  companyId: string;
  budgetYear: number;
  onPatch: (code: string, partial: Partial<ValorFixoItem>) => void;
  onError: (msg: string) => void;
}) {
  const [draft, setDraft] = useState(numberToInput(item.valorBase));
  const dirtyRef = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    setDraft(numberToInput(item.valorBase));
    dirtyRef.current = false;
  }, [item.valorBase]);

  function persistBase() {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    const parsed = parseBrNumber(draft);
    if (parsed != null && Number.isNaN(parsed)) {
      onError("Valor base inválido.");
      setDraft(numberToInput(item.valorBase));
      return;
    }
    onPatch(item.categoryCode, { valorBase: parsed });
    startTransition(async () => {
      const res = await setValorFixoBase(
        companyId,
        budgetYear,
        item.categoryCode,
        item.categoryName,
        parsed,
      );
      if (res?.error) onError(res.error);
    });
  }

  function handleIndice(next: IndiceKey | null) {
    onPatch(item.categoryCode, { indiceKey: next });
    startTransition(async () => {
      const res = await setValorFixoIndice(
        companyId,
        budgetYear,
        item.categoryCode,
        item.categoryName,
        next,
      );
      if (res?.error) onError(res.error);
    });
  }

  function handleMes(next: number | null) {
    onPatch(item.categoryCode, { mesReajuste: next });
    startTransition(async () => {
      const res = await setValorFixoMesReajuste(
        companyId,
        budgetYear,
        item.categoryCode,
        item.categoryName,
        next,
      );
      if (res?.error) onError(res.error);
    });
  }

  const indiceSel = indices.find((i) => i.key === item.indiceKey) ?? null;
  const indiceValue = indiceSel?.value ?? null;
  const indiceUnit = indiceSel?.unit ?? "percent";
  const indiceIndefinido = item.indiceKey != null && indiceValue == null;
  const corrigido = corrigirValorFixo(item.valorBase, indiceValue, indiceUnit);
  const serie = projetarValorFixoSerie(item.valorBase, indiceValue, item.mesReajuste, indiceUnit);
  const totalAno = serie.reduce((a, b) => a + b, 0);
  // Reajuste com índice escolhido mas sem mês → o reajuste ainda não vale.
  const faltaMes = item.valorBase != null && item.indiceKey != null && item.mesReajuste == null;

  return (
    <>
      <tr className="align-top">
        {/* Categoria */}
        <td className="px-3 py-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-start gap-1.5 text-left"
          >
            {expanded ? (
              <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <span>
              <span className="font-medium">{item.categoryName}</span>
              <span className="block text-xs text-muted-foreground">{item.categoryCode}</span>
            </span>
          </button>
        </td>

        {/* Valor base */}
        <td className="px-3 py-2">
          <CurrencyCell
            value={draft}
            onChange={(v) => {
              dirtyRef.current = true;
              setDraft(v);
            }}
            onBlur={persistBase}
            className={cn(CELL, "w-32")}
          />
        </td>

        {/* Índice de correção */}
        <td className="px-3 py-2">
          <select
            value={item.indiceKey ?? ""}
            onChange={(e) =>
              handleIndice(e.target.value === "" ? null : (e.target.value as IndiceKey))
            }
            className={cn(INPUT_CLS, "w-40 py-1.5", item.indiceKey == null && "text-muted-foreground")}
          >
            <option value="">— sem correção</option>
            {indices.map((i) => (
              <option key={i.key} value={i.key}>
                {i.label}
                {i.value != null ? ` — ${formatIndice(i.value, i.unit)}` : " — n/d"}
              </option>
            ))}
          </select>
          {indiceIndefinido && (
            <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-500">
              <TriangleAlert className="h-3 w-3" />
              índice de {budgetYear} não cadastrado
            </div>
          )}
        </td>

        {/* Mês do reajuste */}
        <td className="px-3 py-2">
          <select
            value={item.mesReajuste ?? ""}
            onChange={(e) => handleMes(e.target.value === "" ? null : Number(e.target.value))}
            className={cn(INPUT_CLS, "w-36 py-1.5", item.mesReajuste == null && "text-muted-foreground")}
          >
            <option value="">— sem reajuste</option>
            {MESES_LONGO.map((m, i) => (
              <option key={i} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          {faltaMes && (
            <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-500">
              <TriangleAlert className="h-3 w-3" />
              defina o mês do reajuste
            </div>
          )}
        </td>

        {/* Projeção / orçado */}
        <td className="px-3 py-2 text-right">
          <span className="font-semibold tabular-nums">{formatBRL(totalAno)}</span>
          <div className="text-[11px] text-muted-foreground">
            {item.valorBase == null ? (
              "sem valor base"
            ) : item.mesReajuste == null || corrigido == null || corrigido === item.valorBase ? (
              `${formatBRL(item.valorBase)}/mês`
            ) : (
              `${formatBRL(item.valorBase)} → ${formatBRL(corrigido)} em ${MESES_LONGO[item.mesReajuste - 1].toLowerCase()}`
            )}
          </div>
        </td>
      </tr>

      {/* Detalhe: série mês a mês do ano do orçamento */}
      {expanded && (
        <tr className="bg-muted/20">
          <td colSpan={5} className="px-3 pb-3 pt-1">
            <div className="rounded-md border bg-background p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Orçamento mês a mês {budgetYear}
              </p>
              <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
                {serie.map((v, i) => {
                  const reajustado = item.mesReajuste != null && i + 1 >= item.mesReajuste;
                  return (
                    <div
                      key={i}
                      className={cn(
                        "rounded border px-1.5 py-1 text-center",
                        v === 0 ? "border-dashed text-muted-foreground/60" : "bg-muted/30",
                        reajustado && v !== 0 && "border-emerald-500/40 bg-emerald-500/10",
                      )}
                    >
                      <div className="text-[10px] uppercase text-muted-foreground">{MESES[i]}</div>
                      <div className="text-[11px] tabular-nums">{v === 0 ? "—" : formatBRL(v)}</div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Total do ano:{" "}
                <span className="tabular-nums text-foreground">{formatBRL(totalAno)}</span>
              </p>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Manager ──────────────────────────────────────────────────────────────────

export function ValorFixoManager({ companyId, year }: { companyId: string; year: number }) {
  const [items, setItems] = useState<ValorFixoItem[]>([]);
  const [indices, setIndices] = useState<IndiceOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [search, setSearch] = useState("");

  async function reload(id: string, y: number) {
    if (!id) {
      setItems([]);
      return;
    }
    setLoading(true);
    setLoadError(null);
    setNeedsMigration(false);
    const res = await getValorFixoCategorias(id, y);
    setLoading(false);
    if (res?.needsMigration) {
      setNeedsMigration(true);
      setItems([]);
      return;
    }
    if (res?.error || !res?.setup) {
      setLoadError(res?.error ?? "Falha ao carregar.");
      setItems([]);
      return;
    }
    setItems(res.setup.items);
    setIndices(res.setup.indices);
  }

  useEffect(() => {
    void reload(companyId, year);
    setSearch("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, year]);

  function patchItem(code: string, partial: Partial<ValorFixoItem>) {
    setItems((prev) => prev.map((it) => (it.categoryCode === code ? { ...it, ...partial } : it)));
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.categoryName.toLowerCase().includes(q) || i.categoryCode.toLowerCase().includes(q),
    );
  }, [items, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1 space-y-1.5">
          <label className="text-sm font-medium">Buscar categoria</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nome ou código"
              className={INPUT_CLS + " pl-9"}
            />
          </div>
        </div>
      </div>

      {loadError && (
        <div className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {loadError}
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
            <code className="rounded bg-muted px-1 py-0.5">20260819120000_orcamento_valor_fixo_categorias</code>{" "}
            para habilitar esta tela.
          </p>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          Nenhuma categoria desta empresa está marcada para o método{" "}
          <span className="font-medium">Valor fixo com correção de índices</span> em {year}. Defina o
          método em Configuração → Método por categoria.
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {items.length} categoria(s) orçada(s) por valor fixo. Informe o valor atual, o índice de
            correção e o mês em que o reajuste passa a valer — o sistema monta os 12 meses com o degrau
            do reajuste.
          </p>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Categoria</th>
                  <th className="px-3 py-2.5 font-medium">Valor atual</th>
                  <th className="px-3 py-2.5 font-medium">Correção</th>
                  <th className="px-3 py-2.5 font-medium">Mês do reajuste</th>
                  <th className="px-3 py-2.5 text-right font-medium">Orçado {year}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((item) => (
                  <ValorFixoRow
                    key={item.categoryCode}
                    item={item}
                    indices={indices}
                    companyId={companyId}
                    budgetYear={year}
                    onPatch={patchItem}
                    onError={setLoadError}
                  />
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
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
