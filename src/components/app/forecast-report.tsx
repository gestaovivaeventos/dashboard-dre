"use client";

import type { CSSProperties } from "react";

// ============================================================================
// Relatório de página única (A4 PAISAGEM) da Projeção do Budget e Forecast.
// Segue a mesma identidade visual do ComparativoReport (fontes IBM Plex, card
// escuro de período, título de seção com régua, tabela com cabeçalho escuro),
// mas em layout largo: uma coluna por mês + acumulado, com os meses de
// orçamento destacados em âmbar e sufixo "(Orc)"/"(Real)", como na tela.
// Estilos inline (hex exato) para captura fiel no html2canvas. Renderizado
// oculto e exportado como PDF pelo BudgetForecastView.
// ============================================================================

const FONT_SANS = 'var(--font-plex-sans), "IBM Plex Sans", system-ui, sans-serif';
const FONT_MONO = 'var(--font-plex-mono), "IBM Plex Mono", ui-monospace, monospace';

const C = {
  cardBg: "#ffffff",
  cardBorder: "#e6e4df",
  rule: "#ecece7",
  grid: "#f1efea",
  ink: "#16191f",
  body: "#3c424d",
  sub: "#717784",
  tertiary: "#9aa0ac",
  darkCard: "#1b2532",
  darkLabel: "#8ba7c9",
  // Orçamento (Orc): âmbar, batendo com o amber-700/800 da tela.
  budgetInk: "#92400e",
  budgetHead: "#b45309",
  budgetBg: "#fffbeb",
} as const;

const currency = new Intl.NumberFormat("pt-BR", {
  style: "decimal",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
function fmt(v: number) {
  return currency.format(v);
}

export interface ForecastReportRow {
  id: string;
  code: string;
  name: string;
  level: number;
  is_summary: boolean;
  valuesByBucket: Record<string, number>;
  accumulatedValue: number;
}

interface Props {
  companyLabel: string;
  yearLabel: string;
  periodLabel: string;
  columns: { key: string; label: string }[];
  accumulatedLabel: string;
  // idx >= splitIndex → mês de orçamento; -1 = todos realizados (sem sufixo).
  splitIndex: number;
  rows: ForecastReportRow[];
}

const panelStyle: CSSProperties = {
  border: `1px solid ${C.cardBorder}`,
  borderRadius: 9,
  background: C.cardBg,
  padding: "14px 16px 12px",
};

export function ForecastReport({
  companyLabel,
  yearLabel,
  periodLabel,
  columns,
  accumulatedLabel,
  splitIndex,
  rows,
}: Props) {
  const monthColW = 74;
  const contaW = 250;
  const totalW = 100;
  const tableW = contaW + columns.length * monthColW + totalW;
  const reportW = tableW + 48; // padding lateral 24 + 24

  const th: CSSProperties = {
    fontSize: 9,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    fontWeight: 700,
    color: "#f1f4f8",
    background: "#383c44",
    padding: "8px 8px",
    whiteSpace: "nowrap",
  };
  const tdNum: CSSProperties = {
    fontFamily: FONT_MONO,
    fontSize: 10,
    padding: "6px 8px",
    textAlign: "right",
    whiteSpace: "nowrap",
    borderBottom: `1px solid ${C.grid}`,
  };

  const isBudgetCol = (idx: number) => splitIndex >= 0 && idx >= splitIndex;

  return (
    <div
      style={{
        fontFamily: FONT_SANS,
        background: "#ffffff",
        color: C.body,
        width: reportW,
        padding: 24,
        boxSizing: "border-box",
      }}
    >
      {/* Header */}
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 18,
          alignItems: "flex-start",
          justifyContent: "space-between",
          paddingBottom: 16,
          borderBottom: `1px solid ${C.rule}`,
        }}
      >
        <div style={{ minWidth: 220 }}>
          <div
            style={{
              color: C.tertiary,
              fontSize: 10,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            Relatório — Forecast
          </div>
          <h1
            style={{
              margin: "6px 0 0",
              fontSize: 24,
              lineHeight: 1.1,
              fontWeight: 700,
              color: C.ink,
              letterSpacing: "-0.01em",
            }}
          >
            {companyLabel}
          </h1>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ background: C.darkCard, borderRadius: 8, padding: "12px 16px", minWidth: 130 }}>
            <div
              style={{
                color: C.darkLabel,
                fontSize: 9,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              Ano
            </div>
            <div style={{ color: "#ffffff", fontSize: 20, fontWeight: 700, marginTop: 4 }}>{yearLabel}</div>
            <div style={{ color: C.darkLabel, fontSize: 10, marginTop: 6 }}>{periodLabel}</div>
          </div>
        </div>
      </header>

      <div style={{ height: 16 }} />

      {/* Section title */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <span
          style={{
            color: C.ink,
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          Projeção — Realizado + Orçamento
        </span>
        <span style={{ flex: 1, height: 1, background: C.rule }} aria-hidden />
      </div>

      {/* Tabela */}
      <div style={panelStyle}>
        <table style={{ width: tableW, borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: contaW }} />
            {columns.map((c) => (
              <col key={`col-${c.key}`} style={{ width: monthColW }} />
            ))}
            <col style={{ width: totalW }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>Plano de Contas</th>
              {columns.map((c, idx) => {
                const budget = isBudgetCol(idx);
                const suffix = budget ? " (Orc)" : splitIndex >= 0 ? " (Real)" : "";
                return (
                  <th
                    key={`th-${c.key}`}
                    style={{
                      ...th,
                      textAlign: "right",
                      color: budget ? "#ffe9c7" : "#f1f4f8",
                    }}
                  >
                    {c.label}
                    {suffix}
                  </th>
                );
              })}
              <th style={{ ...th, textAlign: "right" }}>{accumulatedLabel}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isKey = ["4", "6", "8", "11"].includes(row.code);
              const bold = isKey || row.is_summary;
              const rowBg = isKey ? "#eef1f5" : row.is_summary ? "#f7f8fa" : "transparent";
              const nameColor = bold ? C.ink : C.body;
              return (
                <tr key={row.id} style={{ background: rowBg }}>
                  <td
                    style={{
                      fontSize: 11,
                      fontWeight: bold ? 700 : 500,
                      color: nameColor,
                      padding: "6px 8px",
                      paddingLeft: 8 + (row.level - 1) * 12,
                      borderBottom: `1px solid ${C.grid}`,
                      borderTop: isKey ? `1px solid #dfe3ea` : undefined,
                      textTransform: isKey ? "uppercase" : "none",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.name}
                  </td>
                  {columns.map((c, idx) => {
                    const budget = isBudgetCol(idx);
                    const value = row.valuesByBucket[c.key] ?? 0;
                    return (
                      <td
                        key={`${row.id}-${c.key}`}
                        style={{
                          ...tdNum,
                          color: budget ? C.budgetInk : C.ink,
                          fontWeight: bold ? 700 : 500,
                          background: budget && !isKey && !row.is_summary ? C.budgetBg : undefined,
                        }}
                      >
                        {fmt(value)}
                      </td>
                    );
                  })}
                  <td style={{ ...tdNum, color: C.ink, fontWeight: 700 }}>{fmt(row.accumulatedValue)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ marginTop: 10, fontSize: 10, color: C.tertiary, lineHeight: 1.5 }}>
          Valores em R$. Meses marcados <strong>(Real)</strong> usam o realizado; marcados{" "}
          <strong>(Orc)</strong>, o orçamento. A coluna <strong>{accumulatedLabel}</strong> soma os
          meses da projeção.
        </div>
      </div>
    </div>
  );
}
