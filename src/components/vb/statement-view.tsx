"use client";

// Extrato do credor: o que a planilha não dava — recorte por ano, tipo e
// descrição, totais do recorte e a curva do saldo no tempo. O saldo de cada
// linha é calculado uma única vez, em ordem cronológica, sobre o conjunto
// completo; os filtros só escondem linhas, nunca recalculam saldo.

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { VbStatementTable } from "@/components/vb/statement-table";
import { VbStatStrip } from "@/components/vb/stat-strip";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDayBR } from "@/lib/ctrl/datetime";
import { formatBRL } from "@/lib/orcamento/format";
import { compactBRL } from "@/lib/vb/format";
import { currentBalance, ledgerTotals, withRunningBalance } from "@/lib/vb/ledger";
import type { VbEntry, VbEntryKind } from "@/lib/vb/types";

const SELECT_CLS =
  "h-8 rounded-md border border-border bg-surface-1 px-2 text-[13px] text-ink-primary outline-none focus:ring-2 focus:ring-teal-500/40";

const ALL_YEARS = "todos";

const KIND_FILTERS: Array<{ kind: VbEntryKind; label: string; dot: string; on: string }> = [
  { kind: "entrada", label: "Entradas", dot: "bg-emerald-500", on: "border-emerald-600 text-emerald-700" },
  { kind: "saida", label: "Saídas", dot: "bg-red-500", on: "border-red-500 text-red-600" },
  { kind: "rendimento", label: "Rendimentos", dot: "bg-sky-500", on: "border-sky-600 text-sky-700" },
];

/** Busca sem acento e sem caixa: "juros" encontra "Juros de Março". */
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

interface Props {
  /** Lançamentos aprovados do credor, do servidor. Ordem livre — o saldo é recalculado. */
  entries: VbEntry[];
  creditorName: string;
}

export function VbStatementView({ entries, creditorName }: Props) {
  const [year, setYear] = useState(ALL_YEARS);
  const [kinds, setKinds] = useState<Record<VbEntryKind, boolean>>({
    entrada: true,
    saida: true,
    rendimento: true,
  });
  const [query, setQuery] = useState("");

  const rows = useMemo(() => withRunningBalance(entries), [entries]);
  const totals = useMemo(() => ledgerTotals(entries), [entries]);
  const balance = useMemo(() => currentBalance(entries), [entries]);

  const years = useMemo(() => {
    const seen: number[] = [];
    for (const entry of entries) {
      const value = Number(entry.entry_date.slice(0, 4));
      if (!seen.includes(value)) seen.push(value);
    }
    return seen.sort((a, b) => b - a);
  }, [entries]);

  const chartData = useMemo(
    () => rows.map((row) => ({ label: formatDayBR(row.entry_date), saldo: row.balance })),
    [rows],
  );

  const filtered = useMemo(() => {
    const term = normalize(query.trim());
    return rows.filter((row) => {
      if (!kinds[row.kind]) return false;
      if (year !== ALL_YEARS && !row.entry_date.startsWith(year)) return false;
      if (term && !normalize(row.description ?? "").includes(term)) return false;
      return true;
    });
  }, [rows, kinds, year, query]);

  const filtering =
    year !== ALL_YEARS || !(kinds.entrada && kinds.saida && kinds.rendimento) || query.trim() !== "";
  const sliceTotals = useMemo(() => ledgerTotals(filtered), [filtered]);

  function toggleKind(kind: VbEntryKind) {
    setKinds((current) => ({ ...current, [kind]: !current[kind] }));
  }

  return (
    <div className="space-y-3">
      <VbStatStrip
        stats={[
          {
            label: "Saldo atual",
            value: formatBRL(balance),
            emphasis: true,
            tone: balance < 0 ? "negative" : "default",
          },
          { label: "Entradas", value: formatBRL(totals.entradas), tone: "entrada" },
          { label: "Saídas", value: formatBRL(totals.saidas), tone: "saida" },
          { label: "Rendimentos", value: formatBRL(totals.rendimentos), tone: "rendimento" },
        ]}
      />

      {chartData.length >= 2 && (
        <Card className="p-3">
          <div className="mb-1 text-sm font-medium text-ink-primary">Evolução do saldo</div>
          <div aria-label={`Evolução do saldo de ${creditorName}`}>
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  interval="preserveStartEnd"
                  minTickGap={40}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tickFormatter={(value) => compactBRL(Number(value))}
                  width={72}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  formatter={(value) => [formatBRL(Number(value)), "Saldo"]}
                  contentStyle={{ fontSize: 12 }}
                />
                <Area
                  type="monotone"
                  dataKey="saldo"
                  stroke="#0d9488"
                  strokeWidth={2}
                  fill="#0d9488"
                  fillOpacity={0.12}
                  dot={false}
                  name="Saldo"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Filtrar por ano"
          className={SELECT_CLS}
          value={year}
          onChange={(e) => setYear(e.target.value)}
        >
          <option value={ALL_YEARS}>Todos os anos</option>
          {years.map((value) => (
            <option key={value} value={String(value)}>
              {value}
            </option>
          ))}
        </select>

        {KIND_FILTERS.map((filter) => {
          const on = kinds[filter.kind];
          return (
            <button
              key={filter.kind}
              type="button"
              aria-pressed={on}
              onClick={() => toggleKind(filter.kind)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] ${
                on ? `${filter.on} bg-surface-1` : "border-border text-ink-muted opacity-60"
              }`}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${on ? filter.dot : "bg-ink-muted"}`} />
              {filter.label}
            </button>
          );
        })}

        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar na descrição"
          className="h-8 w-[200px] text-[13px]"
          aria-label="Buscar na descrição"
        />

        <div className="ml-auto text-[12px] text-ink-muted">
          {filtered.length} lançamento{filtered.length === 1 ? "" : "s"}
          {filtering && (
            <>
              {" · no recorte: entradas "}
              {formatBRL(sliceTotals.entradas)}
              {" · saídas "}
              {formatBRL(sliceTotals.saidas)}
              {" · rendimentos "}
              {formatBRL(sliceTotals.rendimentos)}
            </>
          )}
        </div>
      </div>

      {/*
        Separador de ano só na lista inteira: o cabeçalho fecha o ano com o
        saldo da linha mais recente dele, número que deixa de ser o saldo do
        ano assim que qualquer filtro esconde linhas.
      */}
      <VbStatementTable
        rows={filtered}
        yearSeparators={!filtering}
        emptyText="Nenhum lançamento neste recorte."
      />
    </div>
  );
}
