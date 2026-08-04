import React from "react";
import {
  Document,
  Page,
  View,
  Text,
  Font,
  StyleSheet,
  renderToBuffer,
  type DocumentProps,
} from "@react-pdf/renderer";

import {
  IBMPlexSans_400,
  IBMPlexSans_500,
  IBMPlexSans_600,
  IBMPlexSans_700,
} from "@/lib/pdf/dre-gerencial-fonts";

// ============================================================================
// PDF do DRE Gerencial (Exportar › PDF do dashboard).
//
// Template @react-pdf que implementa o layout aprovado em
// `docs/modelo DRE Gerencial.dc.html` — A4 paisagem, IBM Plex Sans, hierarquia
// group/sub/leaf/subtotal/final, coluna Total e % ROL.
//
// O modelo de dados recalcula tudo a partir das contas analíticas: grupos e
// subgrupos somam as folhas descendentes; contas calculadas (subtotais)
// avaliam a própria fórmula ("1+2-3") sobre os vetores já recalculados. Assim
// o documento sempre fecha, mesmo que os agregados enviados estejam velhos.
// ============================================================================

// ─── Entrada ─────────────────────────────────────────────────────────────────

export interface DreGerencialMonth {
  key: string;
  label: string;
}

export interface DreGerencialInputRow {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  level: number;
  type: "receita" | "despesa" | "calculado" | "misto";
  is_summary: boolean;
  sort_order: number;
  valuesByBucket: Record<string, number>;
}

export interface DreGerencialInput {
  unidade: string;
  segmento: string;
  periodo: string;
  geradoEm: string;
  geradoPor: string;
  meses: DreGerencialMonth[];
  rows: DreGerencialInputRow[];
}

// ─── Modelo de exibição ──────────────────────────────────────────────────────

type RowKind = "group" | "sub" | "leaf" | "subtotal" | "final";

interface DisplayCell {
  t: string;
  color: string;
}

interface DisplayRow {
  kind: RowKind;
  name: string;
  pad: number; // recuo do nome, em px do layout de referência
  months: DisplayCell[];
  total: DisplayCell;
  av: string;
}

const NEG = "#B42318";
const NEG_DARK = "#FCA5A5";
const ZERO_DIM = "#c4c8ce";
const INK = "#1c2024";

function fmt(v: number): string {
  const n = Math.abs(v) < 0.005 ? 0 : v;
  const s = Math.abs(n).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `(${s})` : s;
}

function cellFor(v: number, dark: boolean): DisplayCell {
  if (dark) return { t: fmt(v), color: v < -0.005 ? NEG_DARK : "#ffffff" };
  if (v < -0.005) return { t: fmt(v), color: NEG };
  if (Math.abs(v) < 0.005) return { t: fmt(v), color: ZERO_DIM };
  return { t: fmt(v), color: INK };
}

// Avalia fórmulas de conta calculada ("1+2-3", "8-9-10", "24.1+24.2-24.3")
// sobre o mapa código → vetor mensal. Termos não resolvidos valem zero.
function parseFormula(formulaLike: string): Array<{ sign: number; code: string }> {
  const out: Array<{ sign: number; code: string }> = [];
  const re = /([+-]?)\s*(\d+(?:\.\d+)*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formulaLike)) !== null) {
    out.push({ sign: m[1] === "-" ? -1 : 1, code: m[2] });
  }
  return out;
}

export function buildDreGerencialRows(
  inputRows: DreGerencialInputRow[],
  meses: DreGerencialMonth[],
  // Fórmulas das contas calculadas, indexadas pelo id da conta (dre_accounts.id).
  // Sem fórmula, a calculada usa o valor enviado (já avaliado pelo motor da tela).
  formulasById?: Record<string, string>,
): DisplayRow[] {
  const nMonths = meses.length;
  const byParent = new Map<string | null, DreGerencialInputRow[]>();
  inputRows.forEach((row) => {
    const list = byParent.get(row.parent_id) ?? [];
    list.push(row);
    byParent.set(row.parent_id, list);
  });
  byParent.forEach((list) =>
    list.sort(
      (a, b) =>
        a.sort_order - b.sort_order ||
        a.code.localeCompare(b.code, undefined, { numeric: true }),
    ),
  );

  // Ordem de documento: caminhada em profundidade a partir da raiz.
  const ordered: DreGerencialInputRow[] = [];
  const walk = (parentId: string | null) => {
    (byParent.get(parentId) ?? []).forEach((row) => {
      ordered.push(row);
      walk(row.id);
    });
  };
  walk(null);

  // Vetores mensais recalculados: folhas → valores enviados; sintéticas →
  // soma dos filhos; calculadas → fórmula (com fallback no valor enviado).
  const vectors = new Map<string, number[]>();
  const visiting = new Set<string>();
  const rawVector = (row: DreGerencialInputRow): number[] =>
    meses.map((mes) => Number(row.valuesByBucket[mes.key] ?? 0));

  const vectorOf = (row: DreGerencialInputRow): number[] => {
    const cached = vectors.get(row.id);
    if (cached) return cached;
    if (visiting.has(row.id)) return rawVector(row);
    visiting.add(row.id);

    let vec: number[];
    const children = byParent.get(row.id) ?? [];
    const formula = formulasById?.[row.id];
    if (row.type === "calculado" && formula) {
      vec = new Array<number>(nMonths).fill(0);
      let resolvedAny = false;
      for (const term of parseFormula(formula)) {
        const target = ordered.find((r) => r.code === term.code && r.id !== row.id);
        if (!target) continue;
        resolvedAny = true;
        const tv = vectorOf(target);
        for (let i = 0; i < nMonths; i++) vec[i] += term.sign * tv[i];
      }
      if (!resolvedAny) vec = rawVector(row);
    } else if (children.length > 0) {
      vec = new Array<number>(nMonths).fill(0);
      children.forEach((child) => {
        const cv = vectorOf(child);
        for (let i = 0; i < nMonths; i++) vec[i] += cv[i];
      });
    } else {
      vec = rawVector(row);
    }

    visiting.delete(row.id);
    vectors.set(row.id, vec);
    return vec;
  };
  ordered.forEach((row) => vectorOf(row));

  // Classificação. A última calculada com cara de resultado final vira `final`.
  const calculadas = ordered.filter((r) => r.type === "calculado");
  const finalCandidates = calculadas.filter((r) => {
    const n = r.name.toLowerCase();
    if (n.includes("antes")) return false;
    return /ap[óo]s\s+ir|resultado/.test(n);
  });
  const finalId =
    finalCandidates.length > 0
      ? finalCandidates[finalCandidates.length - 1].id
      : calculadas.length > 0
        ? calculadas[calculadas.length - 1].id
        : null;

  const kindOf = (row: DreGerencialInputRow): RowKind => {
    if (row.type === "calculado") return row.id === finalId ? "final" : "subtotal";
    const hasChildren = (byParent.get(row.id) ?? []).length > 0;
    if (hasChildren) return row.parent_id === null ? "group" : "sub";
    // Sintética vazia no topo ainda é grupo; analítica de topo (IRPJ, CS) é folha.
    if (row.parent_id === null) return row.is_summary ? "group" : "leaf";
    return "leaf";
  };
  const kinds = new Map<string, RowKind>(ordered.map((row) => [row.id, kindOf(row)]));

  // Base do % ROL: total do período da Receita Líquida (primeira calculada com
  // "líquida" no nome; fallback: primeira calculada).
  const rolRow =
    calculadas.find((r) => /l[íi]quid/.test(r.name.toLowerCase())) ?? calculadas[0] ?? null;
  const rolTotal = rolRow
    ? vectorOf(rolRow).reduce((acc, v) => acc + v, 0)
    : 0;

  return ordered.map((row) => {
    const kind = kinds.get(row.id) ?? "leaf";
    const vec = vectorOf(row);
    const total = vec.reduce((acc, v) => acc + v, 0);
    const dark = kind === "final";

    const parentKind = row.parent_id ? kinds.get(row.parent_id) : undefined;
    const pad =
      kind === "sub"
        ? 16
        : kind === "leaf"
          ? parentKind === "sub"
            ? 34
            : 22
          : 0;

    const av = !rolTotal
      ? "—"
      : Math.abs(total) < 0.005
        ? "—"
        : `${((total / rolTotal) * 100).toLocaleString("pt-BR", {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          })}%`;

    const name =
      kind === "subtotal" || kind === "final"
        ? row.name.trimStart().startsWith("=")
          ? row.name
          : `= ${row.name}`
        : row.name;

    return {
      kind,
      name,
      pad,
      months: vec.map((v) => cellFor(v, dark)),
      total: cellFor(total, dark),
      av,
    };
  });
}

// ─── Documento ───────────────────────────────────────────────────────────────

// O layout aprovado é em px CSS (96dpi); o @react-pdf trabalha em pt (72dpi).
// px * 0.75 preserva exatamente o tamanho físico impresso do HTML de referência.
const px = (n: number) => n * 0.75;

const PAGE_W = 841.89; // A4 paisagem, pt
const MARGIN = 36; // 0.5in
const USABLE_W = PAGE_W - MARGIN * 2;

Font.register({
  family: "IBMPlexSans",
  fonts: [
    { src: IBMPlexSans_400, fontWeight: 400 },
    { src: IBMPlexSans_500, fontWeight: 500 },
    { src: IBMPlexSans_600, fontWeight: 600 },
    { src: IBMPlexSans_700, fontWeight: 700 },
  ],
});
Font.registerHyphenationCallback((word) => [word]);

const ORANGE = "#EA580C";
const RULE_GROUP = "#d8dbdf";
const RULE_SUB = "#eceef0";
const RULE_LEAF = "#f2f3f5";
const RULE_SOFT = "#e3e5e8";

const styles = StyleSheet.create({
  page: {
    fontFamily: "IBMPlexSans",
    fontWeight: 400,
    color: INK,
    paddingTop: MARGIN,
    paddingHorizontal: MARGIN,
    paddingBottom: MARGIN + px(26),
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingBottom: px(14),
    borderBottomWidth: px(2),
    borderBottomColor: INK,
  },
  brandRow: { flexDirection: "row", alignItems: "center", marginBottom: px(14) },
  brandSquare: {
    width: px(14),
    height: px(14),
    borderRadius: px(3),
    backgroundColor: ORANGE,
    marginRight: px(8),
  },
  brandText: {
    fontSize: px(11),
    fontWeight: 600,
    letterSpacing: px(11) * 0.16,
    textTransform: "uppercase",
    color: "#4a5058",
  },
  title: { fontSize: px(30), fontWeight: 600, letterSpacing: px(30) * -0.02 },
  subtitle: { marginTop: px(8), fontSize: px(12.5), color: "#6b7280" },
  emissaoLabel: {
    fontSize: px(9),
    letterSpacing: px(9) * 0.14,
    textTransform: "uppercase",
    color: "#8a9099",
    textAlign: "right",
  },
  emissaoValue: { fontSize: px(12.5), fontWeight: 500, marginTop: px(3), textAlign: "right" },
  metaRow: {
    flexDirection: "row",
    marginBottom: px(18),
    borderBottomWidth: 1,
    borderBottomColor: RULE_SOFT,
  },
  metaCell: { flex: 1, paddingVertical: px(12), paddingHorizontal: px(18) },
  metaDivider: { borderLeftWidth: 1, borderLeftColor: RULE_SOFT },
  metaLabel: {
    fontSize: px(8.5),
    letterSpacing: px(8.5) * 0.14,
    textTransform: "uppercase",
    color: "#8a9099",
  },
  metaValue: { fontSize: px(13), fontWeight: 600, marginTop: px(4) },
  notes: { marginTop: px(16), flexDirection: "row" },
  noteText: { flex: 1, fontSize: px(9), lineHeight: 1.5, color: "#8a9099" },
  footer: {
    position: "absolute",
    left: MARGIN,
    right: MARGIN,
    bottom: px(20),
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: px(8),
    borderTopWidth: 1,
    borderTopColor: RULE_SOFT,
  },
  footerText: {
    fontSize: px(8.5),
    letterSpacing: px(8.5) * 0.04,
    textTransform: "uppercase",
    color: "#8a9099",
  },
});

interface ColumnMetrics {
  nameW: number;
  colW: number;
  avW: number;
  // Fator aplicado às fontes da tabela quando há muitas colunas de mês —
  // mantém todas as colunas dentro da folha sem cortar a última.
  scale: number;
}

function computeColumns(nMonths: number): ColumnMetrics {
  const avW = px(48);
  const baseNameW = px(240);
  let colW = (USABLE_W - baseNameW - avW) / (nMonths + 1);
  colW = Math.min(colW, px(110));
  let scale = 1;
  const comfortable = px(66);
  if (colW < comfortable) {
    const minNameW = px(170);
    colW = (USABLE_W - minNameW - avW) / (nMonths + 1);
    scale = Math.max(0.68, Math.min(1, colW / comfortable));
  }
  const nameW = USABLE_W - avW - colW * (nMonths + 1);
  return { nameW, colW, avW, scale };
}

interface RowSpec {
  nameSize: number;
  nameWeight: 400 | 500 | 600 | 700;
  nameColor: string;
  cellWeight: 400 | 500 | 600 | 700;
  avColor: string;
  avWeight: 400 | 500 | 600 | 700;
  padV: number;
  bg?: string;
  borderTopW?: number;
  borderTopColor?: string;
  borderBottomW?: number;
  borderBottomColor?: string;
}

const ROW_SPECS: Record<RowKind, RowSpec> = {
  group: {
    nameSize: 11,
    nameWeight: 600,
    nameColor: INK,
    cellWeight: 600,
    avColor: "#6b7280",
    avWeight: 500,
    padV: 7,
    bg: "#f1f2f4",
    borderTopW: 1,
    borderTopColor: RULE_GROUP,
    borderBottomW: 1,
    borderBottomColor: RULE_GROUP,
  },
  sub: {
    nameSize: 10.5,
    nameWeight: 600,
    nameColor: "#33383f",
    cellWeight: 600,
    avColor: "#8a9099",
    avWeight: 400,
    padV: 6,
    borderBottomW: 1,
    borderBottomColor: RULE_SUB,
  },
  leaf: {
    nameSize: 10.5,
    nameWeight: 400,
    nameColor: "#4a5058",
    cellWeight: 400,
    avColor: "#a3a8af",
    avWeight: 400,
    padV: 4.5,
    borderBottomW: 1,
    borderBottomColor: RULE_LEAF,
  },
  subtotal: {
    nameSize: 11.5,
    nameWeight: 700,
    nameColor: INK,
    cellWeight: 700,
    avColor: "#4a5058",
    avWeight: 600,
    padV: 9,
    bg: "#fdf6f0",
    borderTopW: 1.5,
    borderTopColor: INK,
    borderBottomW: 1,
    borderBottomColor: RULE_SOFT,
  },
  final: {
    nameSize: 12,
    nameWeight: 700,
    nameColor: "#ffffff",
    cellWeight: 700,
    avColor: "#b6bcc4",
    avWeight: 600,
    padV: 11,
    bg: INK,
  },
};

function TableHeader({ meses, cols }: { meses: DreGerencialMonth[]; cols: ColumnMetrics }) {
  const base = {
    fontSize: px(8.5) * cols.scale,
    fontWeight: 600 as const,
    letterSpacing: px(8.5) * 0.1 * cols.scale,
    textTransform: "uppercase" as const,
    paddingVertical: px(7),
    borderBottomWidth: px(1.5),
    borderBottomColor: INK,
  };
  return (
    <View style={{ flexDirection: "row" }}>
      <View style={{ width: cols.nameW, ...base, paddingRight: px(8) }}>
        <Text style={{ color: "#4a5058", letterSpacing: px(8.5) * 0.12 * cols.scale }}>
          Plano de contas
        </Text>
      </View>
      {meses.map((mes) => (
        <View key={mes.key} style={{ width: cols.colW, ...base, paddingHorizontal: px(8) }}>
          <Text style={{ color: "#4a5058", textAlign: "right", maxLines: 1 }}>
            {mes.label}
          </Text>
        </View>
      ))}
      <View
        style={{
          width: cols.colW,
          ...base,
          paddingHorizontal: px(8),
          fontWeight: 700,
          backgroundColor: "#f6f7f8",
        }}
      >
        <Text style={{ color: INK, textAlign: "right" }}>Total</Text>
      </View>
      <View style={{ width: cols.avW, ...base, paddingLeft: px(8) }}>
        <Text style={{ color: "#8a9099", textAlign: "right", maxLines: 1 }}>
          % ROL
        </Text>
      </View>
    </View>
  );
}

function TableRow({ row, cols }: { row: DisplayRow; cols: ColumnMetrics }) {
  const spec = ROW_SPECS[row.kind];
  const s = cols.scale;
  const rowStyle = {
    flexDirection: "row" as const,
    backgroundColor: spec.bg,
    borderTopWidth: spec.borderTopW !== undefined ? px(spec.borderTopW) : undefined,
    borderTopColor: spec.borderTopColor,
    borderBottomWidth: spec.borderBottomW !== undefined ? px(spec.borderBottomW) : undefined,
    borderBottomColor: spec.borderBottomColor,
  };
  const padV = px(spec.padV);
  const namePadLeft = row.kind === "final" ? px(12) : px(row.pad);
  return (
    <View style={rowStyle} wrap={false}>
      <View
        style={{
          width: cols.nameW,
          paddingVertical: padV,
          paddingLeft: namePadLeft,
          paddingRight: px(8),
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        {row.kind === "group" ? (
          <View
            style={{
              width: px(3),
              height: px(11) * s,
              backgroundColor: ORANGE,
              marginRight: px(8),
            }}
          />
        ) : null}
        <Text
          style={{
            fontSize: px(spec.nameSize) * s,
            fontWeight: spec.nameWeight,
            color: spec.nameColor,
            lineHeight: 1.25,
            flexShrink: 1,
          }}
        >
          {row.name}
        </Text>
      </View>
      {row.months.map((cell, index) => (
        <View
          key={index}
          style={{ width: cols.colW, paddingVertical: padV, paddingHorizontal: px(8), justifyContent: "center" }}
        >
          <Text
            style={{
              fontSize: px(spec.nameSize) * s,
              fontWeight: spec.cellWeight,
              color: cell.color,
              textAlign: "right",
              lineHeight: 1.25,
              maxLines: 1,
            }}
          >
            {cell.t}
          </Text>
        </View>
      ))}
      <View
        style={{
          width: cols.colW,
          paddingVertical: padV,
          paddingHorizontal: px(8),
          justifyContent: "center",
          backgroundColor:
            row.kind === "final" || row.kind === "subtotal" ? undefined : "#f6f7f8",
        }}
      >
        <Text
          style={{
            fontSize: px(spec.nameSize) * s,
            fontWeight: spec.cellWeight,
            color: row.total.color,
            textAlign: "right",
            lineHeight: 1.25,
            maxLines: 1,
          }}
        >
          {row.total.t}
        </Text>
      </View>
      <View
        style={{ width: cols.avW, paddingVertical: padV, paddingLeft: px(8), justifyContent: "center" }}
      >
        <Text
          style={{
            fontSize: px(spec.nameSize) * s,
            fontWeight: spec.avWeight,
            color: spec.avColor,
            textAlign: "right",
            lineHeight: 1.25,
            maxLines: 1,
          }}
        >
          {row.av}
        </Text>
      </View>
    </View>
  );
}

function MetaCell({ label, value, first }: { label: string; value: string; first?: boolean }) {
  return (
    <View style={[styles.metaCell, ...(first ? [] : [styles.metaDivider])]}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

export function DreGerencialDoc({
  input,
  displayRows,
}: {
  input: DreGerencialInput;
  displayRows: DisplayRow[];
}) {
  const cols = computeColumns(input.meses.length);
  return (
    <Document title={`DRE Gerencial — ${input.unidade}`} author="Control Hub">
      <Page size="A4" orientation="landscape" style={styles.page} wrap>
        <View style={styles.header}>
          <View style={{ flexShrink: 1 }}>
            <View style={styles.brandRow}>
              <View style={styles.brandSquare} />
              <Text style={styles.brandText}>Control Hub</Text>
            </View>
            <Text style={styles.title}>Demonstração do Resultado do Exercício</Text>
            <Text style={styles.subtitle}>Visão gerencial analítica · {input.periodo}</Text>
          </View>
          <View>
            <Text style={styles.emissaoLabel}>Emissão</Text>
            <Text style={styles.emissaoValue}>{input.geradoEm}</Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <MetaCell first label="Unidade" value={input.unidade} />
          <MetaCell label="Segmento" value={input.segmento} />
          <MetaCell label="Período de competência" value={input.periodo} />
          <MetaCell label="Regime" value="Competência" />
          <MetaCell label="Valores em" value="R$ (BRL)" />
        </View>

        {/* `fixed` repete o cabeçalho da tabela no topo de toda página. */}
        <View fixed>
          <TableHeader meses={input.meses} cols={cols} />
        </View>
        {displayRows.map((row, index) => (
          <TableRow key={index} row={row} cols={cols} />
        ))}

        <View style={styles.notes}>
          <Text style={[styles.noteText, { marginRight: px(28) }]}>
            Valores em reais, apurados pelo regime de competência. Percentuais calculados
            sobre a Receita Operacional Líquida acumulada do período. Despesas apresentadas
            em valores positivos e deduzidas nos subtotais.
          </Text>
          <Text style={styles.noteText}>
            Documento gerado automaticamente pelo Control Hub a partir dos lançamentos
            conciliados até a data de emissão. Reclassificações posteriores podem alterar os
            saldos aqui apresentados.
          </Text>
        </View>

        <View style={styles.footer} fixed>
          <Text style={[styles.footerText, { color: "#B45309", fontWeight: 600 }]}>
            Confidencial · uso interno da diretoria
          </Text>
          <Text style={styles.footerText}>
            Control Hub · DRE Gerencial · {input.unidade}
          </Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) =>
              `Gerado em ${input.geradoEm} por ${input.geradoPor} · Página ${pageNumber} de ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}

export function buildDreGerencialPdf(
  input: DreGerencialInput,
  formulasById?: Record<string, string>,
): Promise<Buffer> {
  const displayRows = buildDreGerencialRows(input.rows, input.meses, formulasById);
  const el = React.createElement(DreGerencialDoc, {
    input,
    displayRows,
  }) as React.ReactElement<DocumentProps>;
  return renderToBuffer(el);
}
