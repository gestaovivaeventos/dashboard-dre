// src/components/vb/omie-pending-table.tsx
"use client";

import React from "react";

import { formatDayBR } from "@/lib/ctrl/datetime";
import { formatBRL } from "@/lib/orcamento/format";
import { VB_KIND_LABELS, type VbEntryKind, type VbOmieMovement } from "@/lib/vb/types";

export interface OmieSuggestion {
  creditorName: string;
  kind: VbEntryKind;
}

export interface OmiePendingTableProps {
  /** Já na ordem de exibição (mais recente primeiro). */
  rows: VbOmieMovement[];
  /** Por omie_id; ausente ou null = sem sugestão. */
  suggestions: Readonly<Record<string, OmieSuggestion | null>>;
  onLink: (row: VbOmieMovement) => void;
  onDiscard: (row: VbOmieMovement) => void;
  busy?: boolean;
  emptyText: string;
}

const KIND_TONE: Record<VbEntryKind, string> = {
  entrada: "text-emerald-700",
  saida: "text-red-600",
  rendimento: "text-sky-700",
};

const TH = "py-1.5 pr-3 font-medium";

export function OmiePendingTable({ rows, suggestions, onLink, onDiscard, busy, emptyText }: OmiePendingTableProps) {
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-ink-muted">{emptyText}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-ink-muted">
            <th className={TH}>Data</th>
            <th className={TH}>Fornecedor</th>
            <th className={TH}>Descrição</th>
            <th className={TH}>Categoria</th>
            <th className={`${TH} text-right`}>Valor</th>
            <th className={TH}>Sugestão</th>
            <th className="py-1.5 font-medium">
              <span className="sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const suggestion = suggestions[row.omie_id] ?? null;
            return (
              <tr key={row.omie_id} className="border-b border-border/60 hover:bg-surface-2/60">
                <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">{formatDayBR(row.payment_date)}</td>
                <td className="max-w-[220px] truncate py-1.5 pr-3 font-medium text-ink-primary" title={row.supplier_customer ?? undefined}>
                  {row.supplier_customer ?? "—"}
                </td>
                <td className="max-w-[320px] truncate py-1.5 pr-3 text-ink-secondary" title={row.description ?? undefined}>
                  {row.description ?? "—"}
                </td>
                <td className="whitespace-nowrap py-1.5 pr-3 text-ink-muted">{row.category_name ?? row.category_code ?? "—"}</td>
                <td className="whitespace-nowrap py-1.5 pr-3 text-right font-medium tabular-nums text-red-600">{formatBRL(row.value)}</td>
                <td className="whitespace-nowrap py-1.5 pr-3">
                  {suggestion ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-1 px-2 py-0.5 text-[12px]">
                      <span className="text-ink-primary">{suggestion.creditorName}</span>
                      <span className="text-ink-muted">·</span>
                      <span className={KIND_TONE[suggestion.kind]}>{VB_KIND_LABELS[suggestion.kind]}</span>
                    </span>
                  ) : (
                    <span className="text-ink-muted">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => onLink(row)}
                    disabled={busy}
                    className="rounded px-2 py-0.5 text-[12px] font-medium text-teal-700 hover:bg-teal-500/10 disabled:opacity-50"
                  >
                    Vincular
                  </button>
                  <button
                    type="button"
                    onClick={() => onDiscard(row)}
                    disabled={busy}
                    className="ml-1 rounded px-2 py-0.5 text-[12px] text-ink-muted hover:bg-surface-2 hover:text-red-600 disabled:opacity-50"
                  >
                    Descartar
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
