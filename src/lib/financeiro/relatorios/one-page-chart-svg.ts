// ============================================================================
// Gráficos do One Page em SVG puro (sem dependência)
// ============================================================================
//
// POR QUÊ: cliente de e-mail não roda JavaScript, então o recharts da tela
// nunca renderiza lá. Antes os gráficos viravam tabelas — legíveis, mas o
// leitor perdia a leitura visual que a tela dá. Aqui desenhamos as MESMAS
// formas (linha, coluna, barra horizontal, combo) em SVG, que o
// `one-page-chart-png.ts` rasteriza para PNG e o e-mail embute como imagem.
//
// Este módulo é PURO: recebe números e cores, devolve string SVG. Não conhece
// e-mail, resvg nem o payload do relatório — dá para testar e reaproveitar.
//
// As cores NÃO são definidas aqui de propósito: quem chama passa as suas
// (o `C`/`SEV` do one-page-email.ts), senão a paleta divergiria da do e-mail
// na primeira vez que alguém mexesse num dos dois lados.
// ============================================================================

export interface ChartSeries {
  label: string;
  color: string;
  /** null = mês sem dado (buraco na linha / coluna ausente). */
  values: (number | null)[];
  /** Só no combo: define se a série vira coluna ou linha. Default: "line". */
  kind?: "line" | "column";
  /** Tracejada (ex.: meta). */
  dashed?: boolean;
  /**
   * Cor por ponto, sobrepondo `color`. Serve para colunas que mudam de cor
   * conforme o sinal (resultado positivo verde / negativo vermelho).
   */
  pointColors?: Array<string | undefined>;
}

export interface ChartPalette {
  axis: string;
  grid: string;
  label: string;
  valueLabel: string;
  background: string;
}

export interface CartesianChartInput {
  width: number;
  height: number;
  categories: string[];
  series: ChartSeries[];
  palette: ChartPalette;
  /** Formata rótulo de valor (topo da coluna / ponto da linha) e eixo Y. */
  format: (value: number) => string;
  /** Rótulos de valor sobre os pontos/colunas. Default: true. */
  valueLabels?: boolean;
  /** Legenda embaixo. Default: true quando há mais de uma série. */
  legend?: boolean;
}

export interface BarGroup {
  label: string;
  bars: Array<{
    value: number;
    color: string;
    label: string;
    seriesLabel?: string;
    /** Cor do número à direita. Default: a cor da barra. Serve para manter o
     *  sinal verde/vermelho de "acima/abaixo do orçado" mesmo com a barra na
     *  cor neutra da tela. */
    labelColor?: string;
  }>;
}

export interface HorizontalBarsInput {
  width: number;
  categories: BarGroup[];
  palette: ChartPalette;
  /** Legenda embaixo (uma entrada por série do primeiro grupo). */
  legend?: boolean;
}

const FONT = "IBM Plex Sans";

function esc(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Arredonda para 3 casas — SVG não precisa de mais e o arquivo fica menor. */
function r(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function text(
  x: number,
  y: number,
  content: string,
  opts: {
    size?: number;
    color?: string;
    weight?: 400 | 600;
    anchor?: "start" | "middle" | "end";
  } = {},
): string {
  const { size = 10, color = "#3c424d", weight = 400, anchor = "start" } = opts;
  return `<text x="${r(x)}" y="${r(y)}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${esc(
    content,
  )}</text>`;
}

/**
 * Escala "redonda": garante que o zero entre no domínio (senão barra negativa
 * e linha cruzando zero ficam sem referência) e arredonda os limites para um
 * passo legível.
 */
function niceScale(values: number[]): { min: number; max: number; ticks: number[] } {
  const finite = values.filter((v) => Number.isFinite(v));
  let min = Math.min(0, ...finite);
  let max = Math.max(0, ...finite);
  if (min === max) {
    // Série constante (inclusive toda zero): abre uma janela artificial para
    // não dividir por zero no cálculo de altura.
    max = max === 0 ? 1 : max + Math.abs(max) * 0.5;
    min = min === 0 ? -1 : min - Math.abs(min) * 0.5;
  }
  const span = max - min;
  const rawStep = span / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(rawStep) || 1)));
  const normalized = rawStep / magnitude;
  const niceStep =
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const niceMin = Math.floor(min / niceStep) * niceStep;
  const niceMax = Math.ceil(max / niceStep) * niceStep;
  const ticks: number[] = [];
  for (let t = niceMin; t <= niceMax + niceStep / 2; t += niceStep) {
    ticks.push(Math.abs(t) < niceStep / 1000 ? 0 : t);
  }
  // O DOMÍNIO recebe uma folga além do último tick: sem isso o ponto de pico
  // encosta na borda superior da área de plotagem e o rótulo do valor não tem
  // onde caber (ficava em cima da própria linha). As marcas do eixo continuam
  // nos valores redondos — só a escala respira.
  const pad = (niceMax - niceMin) * 0.08;
  return { min: niceMin - pad, max: niceMax + pad, ticks };
}

function legendRow(
  series: Array<{ label: string; color: string; dashed?: boolean }>,
  centerX: number,
  y: number,
  palette: ChartPalette,
): string {
  const ITEM_GAP = 16;
  const CHAR_W = 5.3;
  const MARK_W = 14;
  const widths = series.map((s) => MARK_W + 4 + s.label.length * CHAR_W);
  const total = widths.reduce((a, b) => a + b, 0) + ITEM_GAP * (series.length - 1);
  let x = centerX - total / 2;
  const parts: string[] = [];
  series.forEach((s, i) => {
    parts.push(
      `<rect x="${r(x)}" y="${r(y - 4)}" width="${MARK_W}" height="4" rx="2" fill="${s.color}"${
        s.dashed ? ' opacity="0.75"' : ""
      }/>`,
      text(x + MARK_W + 4, y, s.label, { size: 9.5, color: palette.label }),
    );
    x += widths[i] + ITEM_GAP;
  });
  return parts.join("");
}

function frame(width: number, height: number, palette: ChartPalette, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${palette.background}"/>${body}</svg>`;
}

/** Área de plotagem comum aos gráficos cartesianos. */
function plotBox(
  input: CartesianChartInput,
  showLegend: boolean,
): { left: number; right: number; top: number; bottom: number } {
  return {
    left: 44,
    right: input.width - 10,
    top: input.valueLabels === false ? 12 : 24,
    bottom: input.height - (showLegend ? 40 : 24),
  };
}

function axes(
  input: CartesianChartInput,
  box: { left: number; right: number; top: number; bottom: number },
  scale: { min: number; max: number; ticks: number[] },
): string {
  const { palette, format } = input;
  const yOf = (v: number) =>
    box.bottom - ((v - scale.min) / (scale.max - scale.min)) * (box.bottom - box.top);
  const parts: string[] = [];
  for (const tick of scale.ticks) {
    const y = yOf(tick);
    const isZero = tick === 0;
    parts.push(
      `<line x1="${r(box.left)}" y1="${r(y)}" x2="${r(box.right)}" y2="${r(y)}" stroke="${
        isZero ? palette.axis : palette.grid
      }" stroke-width="1"/>`,
      text(box.left - 6, y + 3.2, format(tick), {
        size: 9,
        color: palette.label,
        anchor: "end",
      }),
    );
  }
  return parts.join("");
}

function categoryLabels(
  input: CartesianChartInput,
  box: { left: number; right: number; bottom: number },
): string {
  const step = (box.right - box.left) / Math.max(1, input.categories.length);
  return input.categories
    .map((c, i) =>
      text(box.left + step * (i + 0.5), box.bottom + 14, c, {
        size: 9.5,
        color: input.palette.label,
        anchor: "middle",
      }),
    )
    .join("");
}

// ─── Linha (1..n séries) ────────────────────────────────────────────────────

export function lineChartSvg(input: CartesianChartInput): string {
  const showLegend = input.legend ?? input.series.length > 1;
  const box = plotBox(input, showLegend);
  const all = input.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const scale = niceScale(all);
  const yOf = (v: number) =>
    box.bottom - ((v - scale.min) / (scale.max - scale.min)) * (box.bottom - box.top);
  const step = (box.right - box.left) / Math.max(1, input.categories.length);
  const xOf = (i: number) => box.left + step * (i + 0.5);

  const parts: string[] = [axes(input, box, scale)];

  for (const s of input.series) {
    // Quebra a linha em segmentos contínuos: null vira buraco, não vira zero.
    const segments: Array<Array<{ x: number; y: number }>> = [];
    let current: Array<{ x: number; y: number }> = [];
    s.values.forEach((v, i) => {
      if (v === null) {
        if (current.length > 0) segments.push(current);
        current = [];
        return;
      }
      current.push({ x: xOf(i), y: yOf(v) });
    });
    if (current.length > 0) segments.push(current);

    for (const seg of segments) {
      if (seg.length === 1) {
        parts.push(
          `<circle cx="${r(seg[0].x)}" cy="${r(seg[0].y)}" r="3" fill="${s.color}"/>`,
        );
        continue;
      }
      const d = seg.map((p, i) => `${i === 0 ? "M" : "L"}${r(p.x)} ${r(p.y)}`).join(" ");
      parts.push(
        `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${
          s.dashed ? ' stroke-dasharray="5 3"' : ""
        }/>`,
      );
      for (const p of seg) {
        parts.push(
          `<circle cx="${r(p.x)}" cy="${r(p.y)}" r="2.6" fill="${input.palette.background}" stroke="${s.color}" stroke-width="1.6"/>`,
        );
      }
    }
  }

  if (input.valueLabels !== false) {
    // Rótulo só da última série (a "Realizado" na tela) — com duas séries
    // sobrepostas os números colidem e o gráfico fica ilegível.
    const s = input.series[input.series.length - 1];
    s.values.forEach((v, i) => {
      if (v === null) return;
      // Vale (menor que os vizinhos) recebe o rótulo ABAIXO; pico e demais,
      // acima. Sem isso o número cai em cima da própria linha nos meses
      // negativos, que é o caso comum do "Resultado do Exercício".
      const prev = s.values[i - 1];
      const next = s.values[i + 1];
      const isTrough =
        (prev === null || prev === undefined || v <= prev) &&
        (next === null || next === undefined || v <= next) &&
        !(prev === undefined && next === undefined);
      // Limites: pode usar a margem superior do SVG (por isso não é box.top),
      // mas nunca invadir a faixa dos rótulos de mês.
      const minY = 11;
      // +3 encosta na linha de base sem invadir os rótulos de mês, que ficam
      // 14px abaixo — dá espaço para o rótulo do ponto final negativo.
      const maxY = box.bottom + 3;
      const above = yOf(v) - 7;
      const below = yOf(v) + 13;
      let y = isTrough ? below : above;
      if (y < minY || y > maxY) y = isTrough ? above : below;
      parts.push(
        text(xOf(i), Math.min(Math.max(y, minY), maxY), input.format(v), {
          size: 9.5,
          weight: 600,
          color: s.color,
          anchor: "middle",
        }),
      );
    });
  }

  parts.push(categoryLabels(input, box));
  if (showLegend) {
    parts.push(
      legendRow(input.series, (box.left + box.right) / 2, input.height - 10, input.palette),
    );
  }
  return frame(input.width, input.height, input.palette, parts.join(""));
}

// ─── Colunas agrupadas ──────────────────────────────────────────────────────

export function columnsChartSvg(input: CartesianChartInput): string {
  const showLegend = input.legend ?? input.series.length > 1;
  const box = plotBox(input, showLegend);
  const all = input.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const scale = niceScale(all);
  const yOf = (v: number) =>
    box.bottom - ((v - scale.min) / (scale.max - scale.min)) * (box.bottom - box.top);
  const step = (box.right - box.left) / Math.max(1, input.categories.length);
  const zeroY = yOf(0);

  const parts: string[] = [axes(input, box, scale)];

  const n = input.series.length;
  const groupW = Math.min(step * 0.66, 46);
  const barW = Math.max(4, (groupW - (n - 1) * 3) / n);

  input.categories.forEach((_, i) => {
    const center = box.left + step * (i + 0.5);
    const startX = center - groupW / 2;
    input.series.forEach((s, si) => {
      const v = s.values[i];
      if (v === null || v === undefined) return;
      const x = startX + si * (barW + 3);
      const y = Math.min(yOf(v), zeroY);
      const h = Math.max(1, Math.abs(yOf(v) - zeroY));
      const fill = s.pointColors?.[i] ?? s.color;
      parts.push(
        `<rect x="${r(x)}" y="${r(y)}" width="${r(barW)}" height="${r(h)}" rx="2" fill="${fill}"/>`,
      );
      if (input.valueLabels !== false && (n === 1 || si === n - 1)) {
        const above = v >= 0;
        parts.push(
          text(x + barW / 2, above ? y - 5 : y + h + 10, input.format(v), {
            size: 9.5,
            weight: 600,
            color: fill,
            anchor: "middle",
          }),
        );
      }
    });
  });

  parts.push(categoryLabels(input, box));
  if (showLegend) {
    parts.push(
      legendRow(input.series, (box.left + box.right) / 2, input.height - 10, input.palette),
    );
  }
  return frame(input.width, input.height, input.palette, parts.join(""));
}

// ─── Combo: colunas + linha (ex.: VVR realizado × meta) ─────────────────────

export function comboChartSvg(input: CartesianChartInput): string {
  const showLegend = input.legend ?? true;
  const box = plotBox(input, showLegend);
  const all = input.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const scale = niceScale(all);
  const yOf = (v: number) =>
    box.bottom - ((v - scale.min) / (scale.max - scale.min)) * (box.bottom - box.top);
  const step = (box.right - box.left) / Math.max(1, input.categories.length);
  const xOf = (i: number) => box.left + step * (i + 0.5);
  const zeroY = yOf(0);

  const parts: string[] = [axes(input, box, scale)];
  const columns = input.series.filter((s) => s.kind === "column");
  const lines = input.series.filter((s) => s.kind !== "column");

  const barW = Math.min(step * 0.5, 26);
  // Rótulos das colunas são acumulados e desenhados DEPOIS das linhas: a linha
  // de meta passa exatamente na altura do topo da coluna e escondia o número.
  const columnLabels: string[] = [];
  for (const s of columns) {
    s.values.forEach((v, i) => {
      if (v === null) return;
      const y = Math.min(yOf(v), zeroY);
      const h = Math.max(1, Math.abs(yOf(v) - zeroY));
      parts.push(
        `<rect x="${r(xOf(i) - barW / 2)}" y="${r(y)}" width="${r(barW)}" height="${r(h)}" rx="2" fill="${s.color}"/>`,
      );
      if (input.valueLabels !== false) {
        columnLabels.push(
          text(xOf(i), v >= 0 ? y - 6 : y + h + 11, input.format(v), {
            size: 9.5,
            weight: 600,
            color: s.color,
            anchor: "middle",
          }),
        );
      }
    });
  }

  for (const s of lines) {
    const pts = s.values
      .map((v, i) => (v === null ? null : { x: xOf(i), y: yOf(v) }))
      .filter((p): p is { x: number; y: number } => p !== null);
    if (pts.length > 1) {
      const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${r(p.x)} ${r(p.y)}`).join(" ");
      parts.push(
        `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"${
          s.dashed ? ' stroke-dasharray="5 3"' : ""
        }/>`,
      );
    }
    for (const p of pts) {
      parts.push(
        `<circle cx="${r(p.x)}" cy="${r(p.y)}" r="2.6" fill="${input.palette.background}" stroke="${s.color}" stroke-width="1.6"/>`,
      );
    }
  }

  parts.push(...columnLabels);
  parts.push(categoryLabels(input, box));
  if (showLegend) {
    parts.push(
      legendRow(input.series, (box.left + box.right) / 2, input.height - 10, input.palette),
    );
  }
  return frame(input.width, input.height, input.palette, parts.join(""));
}

// ─── Barras horizontais agrupadas ───────────────────────────────────────────

/**
 * Usado pelo "Acumulado do Ano" (3 categorias × Orçado/Realizado) e pelos
 * breakdowns (n categorias × 1 barra). A altura é derivada do conteúdo — cada
 * categoria ocupa o mesmo espaço, então o SVG cresce com a lista.
 */
export function horizontalBarsSvg(input: HorizontalBarsInput): string {
  const { categories, palette } = input;
  const barH = 11;
  const barGap = 5;
  const groupGap = 16;
  const labelH = 14;
  const left = 8;
  const right = input.width - 8;
  // Reserva para o rótulo de valor à direita da barra.
  const trackRight = right - 74;

  const groupHeights = categories.map(
    (g) => labelH + g.bars.length * barH + (g.bars.length - 1) * barGap,
  );
  const showLegend =
    (input.legend ?? categories[0]?.bars.some((b) => b.seriesLabel) ?? false) === true;
  const height =
    groupHeights.reduce((a, b) => a + b, 0) +
    groupGap * Math.max(0, categories.length - 1) +
    8 +
    (showLegend ? 26 : 8);

  const max = Math.max(
    1,
    ...categories.flatMap((g) => g.bars.map((b) => Math.abs(b.value))),
  );

  const parts: string[] = [];
  let y = 8;
  for (const group of categories) {
    parts.push(text(left, y + 9, group.label, { size: 10.5, weight: 600, color: palette.label }));
    y += labelH;
    for (const bar of group.bars) {
      const w = Math.max(2, (Math.abs(bar.value) / max) * (trackRight - left));
      parts.push(
        `<rect x="${r(left)}" y="${r(y)}" width="${r(trackRight - left)}" height="${barH}" rx="${
          barH / 2
        }" fill="${palette.grid}"/>`,
        `<rect x="${r(left)}" y="${r(y)}" width="${r(w)}" height="${barH}" rx="${
          barH / 2
        }" fill="${bar.color}"/>`,
        text(right, y + barH - 1.5, bar.label, {
          size: 10,
          weight: 600,
          color: bar.labelColor ?? bar.color,
          anchor: "end",
        }),
      );
      y += barH + barGap;
    }
    y += groupGap - barGap;
  }

  if (showLegend) {
    const series = (categories[0]?.bars ?? [])
      .filter((b) => b.seriesLabel)
      .map((b) => ({ label: b.seriesLabel as string, color: b.color }));
    if (series.length > 0) {
      parts.push(legendRow(series, (left + right) / 2, height - 8, palette));
    }
  }

  return frame(input.width, height, palette, parts.join(""));
}
