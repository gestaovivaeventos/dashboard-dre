"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Plus, Search, Trash2, TriangleAlert } from "lucide-react";

import {
  getValorFixoCategorias,
  saveValorFixoContrato,
  removeValorFixoContrato,
  type IndiceOption,
  type ValorFixoItem,
  type ValorFixoContrato,
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

/** Contrato no estado local da tela: id `null` = ainda não persistido. */
interface LocalContrato {
  /** chave estável de React (id real quando salvo, ou "tmp-*" quando novo). */
  key: string;
  id: string | null;
  descricao: string;
  valorBase: number | null;
  indiceKey: IndiceKey | null;
  mesReajuste: number | null;
}

function seedContratos(item: ValorFixoItem): LocalContrato[] {
  if (item.contratos.length === 0) {
    // Categoria sem nada salvo: uma linha vazia (como a tela de hoje).
    return [{ key: "tmp-0", id: null, descricao: "", valorBase: null, indiceKey: null, mesReajuste: null }];
  }
  return item.contratos.map((c: ValorFixoContrato) => ({
    key: c.id,
    id: c.id,
    descricao: c.descricao ?? "",
    valorBase: c.valorBase,
    indiceKey: c.indiceKey,
    mesReajuste: c.mesReajuste,
  }));
}

/** Série de 12 meses de um contrato, respeitando a unidade do índice. */
function serieContrato(c: LocalContrato, indices: IndiceOption[]): number[] {
  const sel = indices.find((i) => i.key === c.indiceKey) ?? null;
  return projetarValorFixoSerie(c.valorBase, sel?.value ?? null, c.mesReajuste, sel?.unit ?? "percent");
}

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

// ─── Linha de contrato ──────────────────────────────────────────────────────
// Renderiza as 4 colunas de dado (valor, correção, mês, orçado) de UM contrato.
// A 1ª coluna (categoria/descrição) vem de fora via `firstCell`, porque muda
// conforme o modo (linha única x sub-linha de uma categoria com vários).

function ContratoRow({
  firstCell,
  contrato,
  indices,
  budgetYear,
  showRemove,
  onField,
  onCommitBase,
  onRemove,
}: {
  firstCell: React.ReactNode;
  contrato: LocalContrato;
  indices: IndiceOption[];
  budgetYear: number;
  showRemove: boolean;
  onField: (partial: Partial<LocalContrato>) => void;
  onCommitBase: (parsed: number | null) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(numberToInput(contrato.valorBase));
  const dirtyRef = useRef(false);

  useEffect(() => {
    setDraft(numberToInput(contrato.valorBase));
    dirtyRef.current = false;
  }, [contrato.valorBase]);

  function persistBase() {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    const parsed = parseBrNumber(draft);
    if (parsed != null && Number.isNaN(parsed)) {
      setDraft(numberToInput(contrato.valorBase));
      return;
    }
    onCommitBase(parsed);
  }

  const indiceSel = indices.find((i) => i.key === contrato.indiceKey) ?? null;
  const indiceValue = indiceSel?.value ?? null;
  const indiceUnit = indiceSel?.unit ?? "percent";
  const indiceIndefinido = contrato.indiceKey != null && indiceValue == null;
  const corrigido = corrigirValorFixo(contrato.valorBase, indiceValue, indiceUnit);
  const serie = projetarValorFixoSerie(contrato.valorBase, indiceValue, contrato.mesReajuste, indiceUnit);
  const totalAno = serie.reduce((a, b) => a + b, 0);
  const faltaMes = contrato.valorBase != null && contrato.indiceKey != null && contrato.mesReajuste == null;

  return (
    <tr className="align-top">
      {/* Categoria / descrição */}
      <td className="px-3 py-2">{firstCell}</td>

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
          value={contrato.indiceKey ?? ""}
          onChange={(e) =>
            onField({ indiceKey: e.target.value === "" ? null : (e.target.value as IndiceKey) })
          }
          className={cn(INPUT_CLS, "w-40 py-1.5", contrato.indiceKey == null && "text-muted-foreground")}
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
          value={contrato.mesReajuste ?? ""}
          onChange={(e) => onField({ mesReajuste: e.target.value === "" ? null : Number(e.target.value) })}
          className={cn(INPUT_CLS, "w-36 py-1.5", contrato.mesReajuste == null && "text-muted-foreground")}
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

      {/* Orçado do contrato (+ remover, quando há vários) */}
      <td className="px-3 py-2 text-right">
        <div className="flex items-start justify-end gap-2">
          <div>
            <span className="font-semibold tabular-nums">{formatBRL(totalAno)}</span>
            <div className="text-[11px] text-muted-foreground">
              {contrato.valorBase == null ? (
                "sem valor base"
              ) : contrato.mesReajuste == null || corrigido == null || corrigido === contrato.valorBase ? (
                `${formatBRL(contrato.valorBase)}/mês`
              ) : (
                `${formatBRL(contrato.valorBase)} → ${formatBRL(corrigido)} em ${MESES_LONGO[contrato.mesReajuste - 1].toLowerCase()}`
              )}
            </div>
          </div>
          {showRemove && (
            <button
              type="button"
              onClick={onRemove}
              title="Remover contrato"
              className="mt-0.5 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Grupo de uma categoria (1..N contratos) ─────────────────────────────────

function ValorFixoCategoryGroup({
  item,
  indices,
  companyId,
  budgetYear,
  onError,
}: {
  item: ValorFixoItem;
  indices: IndiceOption[];
  companyId: string;
  budgetYear: number;
  onError: (msg: string) => void;
}) {
  const [contratos, setContratos] = useState<LocalContrato[]>(() => seedContratos(item));
  const [expanded, setExpanded] = useState(false);

  // Espelho síncrono do estado, para os saves lerem sempre o valor mais recente.
  const contratosRef = useRef(contratos);
  contratosRef.current = contratos;
  // Fila de saves por contrato (evita insert duplicado do mesmo contrato novo).
  const chainRef = useRef<Map<string, Promise<unknown>>>(new Map());
  // id real obtido no insert, disponível antes do próximo render.
  const idByKeyRef = useRef<Map<string, string>>(new Map());
  const tmpSeq = useRef(1);

  const isMulti = contratos.length >= 2;

  function schedulePersist(key: string, contrato: LocalContrato) {
    const run = async () => {
      const id = contrato.id ?? idByKeyRef.current.get(key) ?? null;
      const requireDescricao = contratosRef.current.length >= 2;
      const res = await saveValorFixoContrato(
        companyId,
        budgetYear,
        item.categoryCode,
        item.categoryName,
        {
          id,
          descricao: contrato.descricao,
          valorBase: contrato.valorBase,
          indiceKey: contrato.indiceKey,
          mesReajuste: contrato.mesReajuste,
        },
        requireDescricao,
      );
      if (res.needsMigration) {
        onError("Migration pendente do módulo Orçamento.");
        return;
      }
      if (res.error) {
        onError(res.error);
        return;
      }
      if (res.id) {
        idByKeyRef.current.set(key, res.id);
        if (!contrato.id) {
          setContratos((prev) => prev.map((c) => (c.key === key ? { ...c, id: res.id! } : c)));
        }
      }
    };
    const prev = chainRef.current.get(key) ?? Promise.resolve();
    chainRef.current.set(key, prev.then(run, run));
  }

  // Aplica a mudança local e (opcionalmente) persiste. O valor fresco vem do
  // ref (atualizado a cada render), então o persist fica FORA do updater do
  // setState — updater puro, sem save duplicado em StrictMode.
  function commit(key: string, partial: Partial<LocalContrato>, persistNow: boolean) {
    const current = contratosRef.current.find((c) => c.key === key);
    const next = current ? { ...current, ...partial } : null;
    setContratos((prev) => prev.map((c) => (c.key === key ? { ...c, ...partial } : c)));
    if (persistNow && next) schedulePersist(key, next);
  }

  function addContrato() {
    const key = `tmp-${tmpSeq.current++}`;
    setContratos((prev) => [
      ...prev,
      { key, id: null, descricao: "", valorBase: null, indiceKey: null, mesReajuste: null },
    ]);
    setExpanded(false);
  }

  async function removeContrato(c: LocalContrato) {
    setContratos((prev) => prev.filter((x) => x.key !== c.key));
    const id = c.id ?? idByKeyRef.current.get(c.key) ?? null;
    if (id) {
      const res = await removeValorFixoContrato(companyId, budgetYear, id);
      if (res.error) onError(res.error);
    }
  }

  // Série somada da categoria — é o que vai para a linha da DRE na prévia.
  const categoriaSerie = contratos.reduce<number[]>(
    (acc, c) => {
      const s = serieContrato(c, indices);
      return acc.map((v, i) => v + (s[i] ?? 0));
    },
    Array<number>(12).fill(0),
  );
  const categoriaTotal = categoriaSerie.reduce((a, b) => a + b, 0);

  const chevron = (
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
  );

  const addBtn = (
    <button
      type="button"
      onClick={addContrato}
      className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
    >
      <Plus className="h-3 w-3" /> contrato
    </button>
  );

  const detailRow = expanded && (
    <tr className="bg-muted/20">
      <td colSpan={5} className="px-3 pb-3 pt-1">
        <div className="rounded-md border bg-background p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Orçamento mês a mês {budgetYear}
            {isMulti && " — soma dos contratos"}
          </p>
          <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
            {categoriaSerie.map((v, i) => (
              <div
                key={i}
                className={cn(
                  "rounded border px-1.5 py-1 text-center",
                  v === 0 ? "border-dashed text-muted-foreground/60" : "bg-muted/30",
                )}
              >
                <div className="text-[10px] uppercase text-muted-foreground">{MESES[i]}</div>
                <div className="text-[11px] tabular-nums">{v === 0 ? "—" : formatBRL(v)}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Total do ano:{" "}
            <span className="tabular-nums text-foreground">{formatBRL(categoriaTotal)}</span>
          </p>
        </div>
      </td>
    </tr>
  );

  // ── Modo LINHA ÚNICA (1 contrato): igual à tela de hoje, sem descrição ──────
  if (!isMulti) {
    const c = contratos[0];
    const firstCell = (
      <div className="space-y-0.5">
        {chevron}
        <div className="pl-5">{addBtn}</div>
      </div>
    );
    return (
      <>
        <ContratoRow
          firstCell={firstCell}
          contrato={c}
          indices={indices}
          budgetYear={budgetYear}
          showRemove={false}
          onField={(partial) => commit(c.key, partial, true)}
          onCommitBase={(parsed) => commit(c.key, { valorBase: parsed }, true)}
          onRemove={() => {}}
        />
        {detailRow}
      </>
    );
  }

  // ── Modo VÁRIOS contratos: cabeçalho da categoria + uma linha por contrato ──
  return (
    <>
      <tr className="border-t-2 bg-muted/30 align-top">
        <td className="px-3 py-2">
          <div className="space-y-0.5">
            {chevron}
            <div className="pl-5">{addBtn}</div>
          </div>
        </td>
        <td colSpan={3} className="px-3 py-2 text-xs text-muted-foreground">
          {contratos.length} contratos nesta categoria — o orçado é a soma deles.
        </td>
        <td className="px-3 py-2 text-right">
          <span className="font-semibold tabular-nums">{formatBRL(categoriaTotal)}</span>
          <div className="text-[11px] text-muted-foreground">total da categoria</div>
        </td>
      </tr>
      {contratos.map((c) => {
        const descricaoFaltando = (c.descricao ?? "").trim() === "";
        const firstCell = (
          <div className="pl-5">
            <input
              value={c.descricao}
              onChange={(e) => commit(c.key, { descricao: e.target.value }, false)}
              onBlur={() => schedulePersist(c.key, contratosRef.current.find((x) => x.key === c.key)!)}
              placeholder="ex.: assessoria financeira"
              className={cn(
                INPUT_CLS,
                "w-52 py-1.5",
                descricaoFaltando && "border-amber-500/60 focus:ring-amber-500",
              )}
            />
            {descricaoFaltando && (
              <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-500">
                <TriangleAlert className="h-3 w-3" />
                descrição obrigatória com vários contratos
              </div>
            )}
          </div>
        );
        return (
          <ContratoRow
            key={c.key}
            firstCell={firstCell}
            contrato={c}
            indices={indices}
            budgetYear={budgetYear}
            showRemove
            onField={(partial) => commit(c.key, partial, true)}
            onCommitBase={(parsed) => commit(c.key, { valorBase: parsed }, true)}
            onRemove={() => removeContrato(c)}
          />
        );
      })}
      {detailRow}
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
            Rode o <code className="rounded bg-muted px-1 py-0.5">db push</code> das migrations{" "}
            <code className="rounded bg-muted px-1 py-0.5">20260819120000_orcamento_valor_fixo_categorias</code>{" "}
            e{" "}
            <code className="rounded bg-muted px-1 py-0.5">20260820120000_orcamento_valor_fixo_contratos</code>{" "}
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
            correção e o mês do reajuste. Se a categoria reúne mais de um contrato (fornecedores/valores
            diferentes), use <span className="font-medium">+ contrato</span> — o orçado da categoria é a
            soma deles.
          </p>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Categoria / contrato</th>
                  <th className="px-3 py-2.5 font-medium">Valor atual</th>
                  <th className="px-3 py-2.5 font-medium">Correção</th>
                  <th className="px-3 py-2.5 font-medium">Mês do reajuste</th>
                  <th className="px-3 py-2.5 text-right font-medium">Orçado {year}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((item) => (
                  <ValorFixoCategoryGroup
                    key={`${companyId}:${year}:${item.categoryCode}`}
                    item={item}
                    indices={indices}
                    companyId={companyId}
                    budgetYear={year}
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
