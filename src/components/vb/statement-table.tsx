// Extrato do VB em formato de extrato bancário: uma tabela só, densa, com a
// cor carregando o tipo do lançamento. Serve as duas telas — o extrato do
// credor (separador de ano, totais) e a revisão do lote (flags e ações por
// linha).
//
// Sem hooks de propósito: a página do credor é server component. Quando o pai
// passa onEdit/onDelete ele é que é client ("use client" em batch-review).

import { Pencil, Trash2 } from "lucide-react";
import React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDayBR } from "@/lib/ctrl/datetime";
import { formatBRL } from "@/lib/orcamento/format";
import { describeRendimento } from "@/lib/vb/format";
import { ledgerTotals, type WithBalance } from "@/lib/vb/ledger";
import { VB_FLAG_LABELS, isBlockingFlag, type VbEntry, type VbEntryKind } from "@/lib/vb/types";

export type StatementRow = WithBalance<VbEntry>;

interface StatementTableProps {
  /**
   * Já com `balance`, em ordem CRONOLÓGICA (ordem de importação na revisão) —
   * o saldo de cada linha é o saldo acumulado até ela. A tabela inverte
   * internamente para exibir do mais recente para o mais antigo; os pais
   * continuam entregando a ordem em que o saldo foi calculado.
   */
  rows: StatementRow[];
  /** Separadores por ano com totais (extrato). */
  yearSeparators?: boolean;
  /** Revisão: flags sob a descrição. */
  showFlags?: boolean;
  onEdit?: (row: StatementRow) => void;
  onDelete?: (row: StatementRow) => void;
  emptyText?: string;
}

const MINUS = "−";

const DOT_BY_KIND: Record<VbEntryKind, string> = {
  entrada: "bg-emerald-500",
  saida: "bg-red-500",
  rendimento: "bg-sky-500",
};

/** Valor com sinal e cor do tipo — a leitura de extrato é pelo sinal, não pela coluna. */
function amountOf(row: StatementRow): { text: string; className: string } {
  const value = formatBRL(Math.abs(row.amount));
  if (row.kind === "entrada") return { text: `+${value}`, className: "text-emerald-700" };
  if (row.kind === "saida") return { text: `${MINUS}${value}`, className: "text-red-600" };
  return { text: `${row.amount < 0 ? MINUS : "+"}${value}`, className: "text-sky-700" };
}

function yearOf(row: StatementRow): number {
  return Number(row.entry_date.slice(0, 4));
}

/** Agrupa preservando a ordem recebida (as linhas já vêm com o saldo pronto). */
function groupsInOrder(rows: StatementRow[]): Array<{ year: number; rows: StatementRow[] }> {
  const out: Array<{ year: number; rows: StatementRow[] }> = [];
  for (const row of rows) {
    const year = yearOf(row);
    const last = out[out.length - 1];
    if (last && last.year === year) last.rows.push(row);
    else out.push({ year, rows: [row] });
  }
  return out;
}

export function VbStatementTable({
  rows,
  yearSeparators = false,
  showFlags = false,
  onEdit,
  onDelete,
  emptyText,
}: StatementTableProps) {
  const hasActions = Boolean(onEdit || onDelete);
  const columns = 4 + (hasActions ? 1 : 0);

  if (rows.length === 0) {
    return (
      <div className="overflow-x-auto rounded-md border border-border bg-surface-1">
        <p className="px-3 py-6 text-center text-sm text-ink-muted">{emptyText ?? "Nenhum lançamento."}</p>
      </div>
    );
  }

  // Mais recente em cima. O saldo veio calculado em ordem cronológica, então a
  // inversão é só de exibição — nada é recomputado aqui.
  const newestFirst = [...rows].reverse();
  const groups = yearSeparators ? groupsInOrder(newestFirst) : [{ year: 0, rows: newestFirst }];

  return (
    <div className="overflow-x-auto rounded-md border border-border bg-surface-1">
      <table className="w-full text-[13px] leading-tight">
        <thead className="sticky top-0 z-10 bg-surface-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          <tr>
            <th className="px-3 py-1.5 text-left">Data</th>
            <th className="px-3 py-1.5 text-left">Descrição</th>
            <th className="px-3 py-1.5 text-right">Valor</th>
            <th className="px-3 py-1.5 text-right">Saldo</th>
            {hasActions && <th className="px-3 py-1.5" />}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <YearBlock
              key={group.year}
              group={group}
              columns={columns}
              yearSeparators={yearSeparators}
              showFlags={showFlags}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface YearBlockProps {
  group: { year: number; rows: StatementRow[] };
  columns: number;
  yearSeparators: boolean;
  showFlags: boolean;
  onEdit?: (row: StatementRow) => void;
  onDelete?: (row: StatementRow) => void;
}

function YearBlock({ group, columns, yearSeparators, showFlags, onEdit, onDelete }: YearBlockProps) {
  const totals = yearSeparators ? ledgerTotals(group.rows) : null;
  // Grupo já invertido: a primeira linha é a mais recente do ano.
  const closing = group.rows[0].balance;

  return (
    <>
      {totals && (
        <tr>
          <td colSpan={columns} className="bg-surface-2/70 px-3 py-1 text-xs">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <span className="font-semibold text-ink-primary">{group.year}</span>
              <span className="text-ink-muted">
                entradas {formatBRL(totals.entradas)} · saídas {formatBRL(totals.saidas)} · rendimentos{" "}
                {formatBRL(totals.rendimentos)} · saldo no fim do ano{" "}
                <strong className={closing < 0 ? "text-red-600" : "text-ink-primary"}>{formatBRL(closing)}</strong>
              </span>
            </div>
          </td>
        </tr>
      )}
      {group.rows.map((row) => (
        <StatementLine key={row.id} row={row} showFlags={showFlags} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </>
  );
}

interface StatementLineProps {
  row: StatementRow;
  showFlags: boolean;
  onEdit?: (row: StatementRow) => void;
  onDelete?: (row: StatementRow) => void;
}

function StatementLine({ row, showFlags, onEdit, onDelete }: StatementLineProps) {
  const amount = amountOf(row);
  const blocking = row.flags.some(isBlockingFlag);
  // Fundo vermelho claro sinaliza bloqueio: a linha impede aprovar o lote.
  const rowTone = blocking ? "bg-red-500/5" : "";
  const rendimento = row.kind === "rendimento" ? describeRendimento(row) : null;

  return (
    <tr className={`group border-b border-border/60 hover:bg-surface-2/60 ${rowTone}`}>
      <td className="whitespace-nowrap px-3 py-1.5 align-top tabular-nums">{formatDayBR(row.entry_date)}</td>
      <td className="px-3 py-1.5 align-top">
        <div className="flex items-start gap-2">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT_BY_KIND[row.kind]}`} />
          <div>
            <div>{row.description ?? "—"}</div>
            {rendimento && <div className="text-[11px] text-ink-muted">{rendimento}</div>}
            {showFlags && row.flags.length > 0 && (
              <div className="mt-0.5 flex flex-wrap gap-1">
                {row.flags.map((flag) => (
                  <Badge
                    key={flag}
                    variant={isBlockingFlag(flag) ? "destructive" : "outline"}
                    className="whitespace-nowrap px-1.5 py-0 text-[10px]"
                  >
                    {VB_FLAG_LABELS[flag]}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      </td>
      <td className={`whitespace-nowrap px-3 py-1.5 text-right align-top font-medium tabular-nums ${amount.className}`}>
        {amount.text}
      </td>
      <td
        className={`px-3 py-1.5 text-right align-top font-semibold tabular-nums ${row.balance < 0 ? "text-red-600" : ""}`}
      >
        {formatBRL(row.balance)}
      </td>
      {(onEdit || onDelete) && (
        <td className="whitespace-nowrap px-3 py-1.5 align-top">
          {onEdit && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 opacity-60 group-hover:opacity-100"
              onClick={() => onEdit(row)}
              aria-label="Editar lançamento"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {onDelete && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 opacity-60 group-hover:opacity-100"
              onClick={() => onDelete(row)}
              aria-label="Excluir lançamento"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </td>
      )}
    </tr>
  );
}
