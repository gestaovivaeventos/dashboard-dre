"use client";

import type { CSSProperties } from "react";

// ============================================================================
// Relatório de página única (A4 retrato) dos Comparativos Anuais, seguindo a
// identidade visual do relatório do Business Intelligence (OnePageReportPreview):
// fontes IBM Plex Sans/Mono, paleta neutra, header com card escuro de período,
// título de seção com régua, cards brancos e chips de variação. Estilos inline
// (hex exato) para captura fiel no html2canvas. Renderizado oculto e exportado
// como PDF pelo ComparativosAnuaisView.
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
  prior: "#4a6288",
} as const;

const SEV = {
  positive: { text: "#27824f", bg: "#e7f3ec", border: "#cfe7d8" },
  critical: { text: "#c0392b", bg: "#fbecec", border: "#f1d3d3" },
  neutral: { text: "#717784", bg: "#f1f1ee", border: "#e3e2db" },
};

const currency = new Intl.NumberFormat("pt-BR", {
  style: "decimal",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
function fmt(v: number) {
  return currency.format(v);
}
function formatVar(a: number, b: number): string {
  if (a === 0) return "–";
  const pct = ((b - a) / Math.abs(a)) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}
function varSev(a: number, b: number) {
  if (a === 0) return SEV.neutral;
  const pct = ((b - a) / Math.abs(a)) * 100;
  return pct >= 0 ? SEV.positive : SEV.critical;
}

export interface ComparativoReportRow {
  id: string;
  code: string;
  name: string;
  level: number;
  is_summary: boolean;
  realizado: number;
  orcado: number;
  anoAnterior: number;
}

interface Props {
  companyLabel: string;
  periodLabel: string;
  priorPeriodLabel: string;
  rows: ComparativoReportRow[];
}

const panelStyle: CSSProperties = {
  border: `1px solid ${C.cardBorder}`,
  borderRadius: 9,
  background: C.cardBg,
  padding: "14px 16px 12px",
};

function Chip({ label, sev }: { label: string; sev: { text: string; bg: string; border: string } }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 46,
        padding: "2px 8px",
        boxSizing: "border-box",
        borderRadius: 5,
        border: `1px solid ${sev.border}`,
        background: sev.bg,
        color: sev.text,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.4,
        fontFamily: FONT_MONO,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

export function ComparativoReport({ companyLabel, periodLabel, priorPeriodLabel, rows }: Props) {
  const th: CSSProperties = {
    fontSize: 9,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    fontWeight: 700,
    color: "#f1f4f8",
    background: "#383c44",
    padding: "9px 10px",
  };
  const tdNum: CSSProperties = {
    fontFamily: FONT_MONO,
    fontSize: 12,
    padding: "7px 10px",
    textAlign: "right",
    whiteSpace: "nowrap",
    borderBottom: `1px solid ${C.grid}`,
  };

  return (
    <div style={{ fontFamily: FONT_SANS, background: "#ffffff", color: C.body, width: 860, padding: 28, boxSizing: "border-box" }}>
      {/* Header */}
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 18,
          alignItems: "flex-start",
          justifyContent: "space-between",
          paddingBottom: 18,
          borderBottom: `1px solid ${C.rule}`,
        }}
      >
        <div style={{ minWidth: 220 }}>
          <div style={{ color: C.tertiary, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 700 }}>
            Relatório — Comparativo Anual
          </div>
          <h1 style={{ margin: "6px 0 0", fontSize: 26, lineHeight: 1.1, fontWeight: 700, color: C.ink, letterSpacing: "-0.01em" }}>
            {companyLabel}
          </h1>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ background: C.darkCard, borderRadius: 8, padding: "12px 16px", minWidth: 150 }}>
            <div style={{ color: C.darkLabel, fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", fontWeight: 600 }}>
              Período
            </div>
            <div style={{ color: "#ffffff", fontSize: 18, fontWeight: 700, marginTop: 4 }}>{periodLabel}</div>
            <div style={{ color: C.darkLabel, fontSize: 10, marginTop: 6 }}>Ano anterior: {priorPeriodLabel}</div>
          </div>
        </div>
      </header>

      <div style={{ height: 18 }} />

      {/* Section title */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <span style={{ color: C.ink, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 700, whiteSpace: "nowrap" }}>
          Realizado × Orçado × Ano Anterior
        </span>
        <span style={{ flex: 1, height: 1, background: C.rule }} aria-hidden />
      </div>

      {/* Tabela */}
      <div style={panelStyle}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup>
            <col />
            <col style={{ width: 118 }} />
            <col style={{ width: 118 }} />
            <col style={{ width: 82 }} />
            <col style={{ width: 118 }} />
            <col style={{ width: 82 }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>Contas</th>
              <th style={{ ...th, textAlign: "right" }}>Realizado</th>
              <th style={{ ...th, textAlign: "right" }}>Orçado</th>
              <th style={{ ...th, textAlign: "center" }}>Prev. × Real.</th>
              <th style={{ ...th, textAlign: "right" }}>Ano Anterior</th>
              <th style={{ ...th, textAlign: "center" }}>Atual × Anter.</th>
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
                      fontSize: 12,
                      fontWeight: bold ? 700 : 500,
                      color: nameColor,
                      padding: "7px 10px",
                      paddingLeft: 10 + (row.level - 1) * 13,
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
                  <td style={{ ...tdNum, color: C.ink, fontWeight: bold ? 700 : 600 }}>{fmt(row.realizado)}</td>
                  <td style={{ ...tdNum, color: C.sub, fontWeight: bold ? 700 : 400 }}>{fmt(row.orcado)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "center", borderBottom: `1px solid ${C.grid}` }}>
                    <Chip label={formatVar(row.orcado, row.realizado)} sev={varSev(row.orcado, row.realizado)} />
                  </td>
                  <td style={{ ...tdNum, color: C.prior, fontWeight: bold ? 700 : 500 }}>{fmt(row.anoAnterior)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "center", borderBottom: `1px solid ${C.grid}` }}>
                    <Chip label={formatVar(row.anoAnterior, row.realizado)} sev={varSev(row.anoAnterior, row.realizado)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ marginTop: 10, fontSize: 10, color: C.tertiary, lineHeight: 1.5 }}>
          Valores em R$. <strong>Prev. × Real.</strong> = variação do Realizado sobre o Orçado.{" "}
          <strong>Atual × Anter.</strong> = variação do Realizado sobre o mesmo período do ano anterior.
        </div>
      </div>
    </div>
  );
}
