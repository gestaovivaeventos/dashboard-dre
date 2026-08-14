"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
  TriangleAlert,
} from "lucide-react";

import {
  calcularMedia,
  getMediaCategorias,
  recalcularTodasMedias,
  setMediaIndice,
  setMediaValor,
  type IndiceOption,
  type MediaCategoriaItem,
} from "@/lib/orcamento/actions/media";
import { projetarMedia } from "@/lib/orcamento/media-calc";
import { formatBRL, numberToInput, parseBrNumber } from "@/lib/orcamento/format";
import type { IndiceKey } from "@/lib/orcamento/indices";
import { cn } from "@/lib/utils";

const INPUT_CLS =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
const CELL =
  "w-full rounded border bg-background px-2 py-1 text-sm text-right tabular-nums outline-none focus:ring-1 focus:ring-ring disabled:opacity-40 disabled:bg-muted/40";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Célula de moeda: mostra "R$ 3.000,00" fora de foco; ao focar, valor cru. */
function CurrencyCell({
  value,
  onChange,
  onFocus,
  onBlur,
  disabled,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onFocus?: () => void;
  onBlur: () => void;
  disabled?: boolean;
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
        onFocus?.();
        const el = e.target;
        requestAnimationFrame(() => el.select());
      }}
      onBlur={() => {
        setFocused(false);
        onBlur();
      }}
      inputMode="decimal"
      placeholder="R$ 0,00"
      disabled={disabled}
      className={className}
    />
  );
}

// ─── Linha ──────────────────────────────────────────────────────────────────

function MediaRow({
  item,
  indices,
  baseYear,
  budgetYear,
  onPatch,
  onError,
  companyId,
}: {
  item: MediaCategoriaItem;
  indices: IndiceOption[];
  baseYear: number;
  budgetYear: number;
  onPatch: (code: string, partial: Partial<MediaCategoriaItem>) => void;
  onError: (msg: string) => void;
  companyId: string;
}) {
  // Média efetiva usada para exibir e projetar: o snapshot salvo, ou a sugestão
  // ao vivo do realizado enquanto nada foi salvo.
  const efetiva = item.mediaValor ?? item.realizado.media;
  const [draft, setDraft] = useState(numberToInput(efetiva));
  const dirtyRef = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [recalcing, setRecalcing] = useState(false);
  const [, startTransition] = useTransition();

  // Recarrega o rascunho quando o item muda (reload, recalcular, troca de ano).
  useEffect(() => {
    setDraft(numberToInput(item.mediaValor ?? item.realizado.media));
    dirtyRef.current = false;
  }, [item.mediaValor, item.realizado.media]);

  const naoSalva = item.mediaValor == null && item.realizado.media != null;

  function persistValor() {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    const parsed = parseBrNumber(draft);
    if (parsed != null && Number.isNaN(parsed)) {
      onError("Valor da média inválido.");
      setDraft(numberToInput(item.mediaValor ?? item.realizado.media));
      return;
    }
    onPatch(item.categoryCode, { mediaValor: parsed, manual: parsed != null });
    startTransition(async () => {
      const res = await setMediaValor(
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
      const res = await setMediaIndice(
        companyId,
        budgetYear,
        item.categoryCode,
        item.categoryName,
        next,
      );
      if (res?.error) onError(res.error);
    });
  }

  function handleRecalcular() {
    setRecalcing(true);
    startTransition(async () => {
      const res = await calcularMedia(
        companyId,
        budgetYear,
        item.categoryCode,
        item.categoryName,
      );
      setRecalcing(false);
      if (res?.error) {
        onError(res.error);
        return;
      }
      if (res?.item) {
        // Preserva o índice (a action não o altera).
        onPatch(item.categoryCode, {
          mediaValor: res.item.mediaValor,
          manual: false,
          realizado: res.item.realizado,
          baseYear: res.item.baseYear,
          mesesConsiderados: res.item.mesesConsiderados,
          calculadoEm: res.item.calculadoEm,
        });
      }
    });
  }

  const indiceSel = indices.find((i) => i.key === item.indiceKey) ?? null;
  const indiceValue = indiceSel?.value ?? null;
  const indiceIndefinido = item.indiceKey != null && indiceValue == null;
  const projetado = projetarMedia(efetiva, indiceValue);

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

        {/* Média */}
        <td className="px-3 py-2">
          <div className="flex items-center gap-1.5">
            <CurrencyCell
              value={draft}
              onChange={(v) => {
                dirtyRef.current = true;
                setDraft(v);
              }}
              onBlur={persistValor}
              className={cn(CELL, "w-32", naoSalva && "text-muted-foreground")}
            />
            <button
              type="button"
              onClick={handleRecalcular}
              disabled={recalcing}
              title={`Recalcular pela média do realizado de ${baseYear}`}
              className="shrink-0 rounded border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              {recalcing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {naoSalva ? (
              <span className="text-amber-600 dark:text-amber-500">
                sugestão — recalcular p/ salvar
              </span>
            ) : item.manual ? (
              "editada manualmente"
            ) : item.calculadoEm ? (
              `${item.mesesConsiderados ?? item.realizado.mesesComValor} de 12 meses`
            ) : item.realizado.media == null ? (
              `sem realizado em ${baseYear}`
            ) : (
              `${item.realizado.mesesComValor} de 12 meses`
            )}
          </div>
        </td>

        {/* Índice de correção */}
        <td className="px-3 py-2">
          <select
            value={item.indiceKey ?? ""}
            onChange={(e) =>
              handleIndice(e.target.value === "" ? null : (e.target.value as IndiceKey))
            }
            className={cn(INPUT_CLS, "w-44 py-1.5", item.indiceKey == null && "text-muted-foreground")}
          >
            <option value="">— sem correção</option>
            {indices.map((i) => (
              <option key={i.key} value={i.key}>
                {i.label}
                {i.value != null ? ` — ${i.value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : " — n/d"}
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

        {/* Projeção mensal */}
        <td className="px-3 py-2 text-right">
          <span className="font-semibold tabular-nums">{formatBRL(projetado)}</span>
          {indiceValue != null && efetiva != null && (
            <div className="text-[11px] text-muted-foreground">
              {formatBRL(efetiva)} + {indiceValue.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%
            </div>
          )}
        </td>
      </tr>

      {/* Detalhe: realizado mês a mês do ano-base */}
      {expanded && (
        <tr className="bg-muted/20">
          <td colSpan={4} className="px-3 pb-3 pt-1">
            <div className="rounded-md border bg-background p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Realizado {baseYear} (Omie) — meses sem pagamento não entram na média
              </p>
              <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
                {item.realizado.meses.map((v, i) => (
                  <div
                    key={i}
                    className={cn(
                      "rounded border px-1.5 py-1 text-center",
                      v == null ? "border-dashed text-muted-foreground/60" : "bg-muted/30",
                    )}
                  >
                    <div className="text-[10px] uppercase text-muted-foreground">{MESES[i]}</div>
                    <div className="text-[11px] tabular-nums">
                      {v == null ? "—" : formatBRL(v)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                <span>
                  Total: <span className="tabular-nums text-foreground">{formatBRL(item.realizado.total)}</span>
                </span>
                <span>
                  Meses com pagamento:{" "}
                  <span className="tabular-nums text-foreground">{item.realizado.mesesComValor}</span>
                </span>
                <span>
                  Média:{" "}
                  <span className="tabular-nums text-foreground">{formatBRL(item.realizado.media)}</span>
                </span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Manager ──────────────────────────────────────────────────────────────────

export function MediaCorrecaoManager({
  companyId,
  year,
}: {
  companyId: string;
  year: number;
}) {
  const [items, setItems] = useState<MediaCategoriaItem[]>([]);
  const [indices, setIndices] = useState<IndiceOption[]>([]);
  const [baseYear, setBaseYear] = useState<number>(year - 1);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [recalcAll, setRecalcAll] = useState(false);
  const [search, setSearch] = useState("");
  const [, startTransition] = useTransition();

  async function reload(id: string, y: number) {
    if (!id) {
      setItems([]);
      return;
    }
    setLoading(true);
    setLoadError(null);
    setNeedsMigration(false);
    const res = await getMediaCategorias(id, y);
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
    setBaseYear(res.setup.baseYear);
  }

  useEffect(() => {
    void reload(companyId, year);
    setSearch("");
    setFeedback(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, year]);

  function patchItem(code: string, partial: Partial<MediaCategoriaItem>) {
    setItems((prev) => prev.map((it) => (it.categoryCode === code ? { ...it, ...partial } : it)));
  }

  function handleRecalcAll() {
    if (!companyId) return;
    setRecalcAll(true);
    setFeedback(null);
    startTransition(async () => {
      const res = await recalcularTodasMedias(companyId, year);
      setRecalcAll(false);
      if (res?.error) {
        setLoadError(res.error);
        return;
      }
      await reload(companyId, year);
      setFeedback(`${res?.atualizadas ?? 0} média(s) recalculada(s) pela Omie (base ${year - 1}).`);
    });
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
      {/* Toolbar */}
      <div className="flex flex-wrap items-end gap-3">
        <button
          type="button"
          onClick={handleRecalcAll}
          disabled={loading || recalcAll || !companyId || items.length === 0}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors"
        >
          {recalcAll ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Recalcular todas
        </button>
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

      {feedback && (
        <div className="rounded-md bg-emerald-500/10 px-4 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          {feedback}
        </div>
      )}
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
            <code className="rounded bg-muted px-1 py-0.5">20260731140000_orcamento_media_categorias</code>{" "}
            para habilitar esta tela.
          </p>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          Nenhuma categoria desta empresa está marcada para o método{" "}
          <span className="font-medium">Média com correção de índices</span> em {year}. Defina o
          método em Configurações → Método de orçamento por categoria.
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {items.length} categoria(s) orçada(s) por média. A média usa o realizado de{" "}
            <span className="font-medium text-foreground">{baseYear}</span> (Omie); meses sem
            pagamento no ano-base não entram no cálculo.
          </p>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Categoria</th>
                  <th className="px-3 py-2.5 font-medium">Média {baseYear}</th>
                  <th className="px-3 py-2.5 font-medium">Correção</th>
                  <th className="px-3 py-2.5 text-right font-medium">Projeção mensal {year}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((item) => (
                  <MediaRow
                    key={item.categoryCode}
                    item={item}
                    indices={indices}
                    baseYear={baseYear}
                    budgetYear={year}
                    companyId={companyId}
                    onPatch={patchItem}
                    onError={setLoadError}
                  />
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
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
