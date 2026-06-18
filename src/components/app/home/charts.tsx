"use client";

// Mini-gráficos leves (SVG/divs), sem dependência externa. Para a Visão Geral.

export function Sparkline({
  values,
  width = 132,
  height = 36,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;

  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const range = max - min || 1;
  const n = values.length;

  const x = (i: number) => (i / (n - 1)) * (width - 2) + 1;
  const y = (v: number) => height - 2 - ((v - min) / range) * (height - 4);

  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values[n - 1];
  const positive = last >= 0;
  const stroke = positive ? "var(--viva-orange-500)" : "var(--status-critical)";
  const zeroY = y(0);

  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden>
      {/* linha do zero */}
      <line
        x1={1}
        x2={width - 1}
        y1={zeroY}
        y2={zeroY}
        stroke="var(--border-default)"
        strokeWidth={1}
        strokeDasharray="2 3"
      />
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={x(n - 1)} cy={y(last)} r={2.5} fill={stroke} />
    </svg>
  );
}

export function ReceitaDespesaBars({
  data,
}: {
  data: { label: string; receita: number; despesa: number }[];
}) {
  if (data.length === 0) return null;
  const max = Math.max(1, ...data.flatMap((d) => [d.receita, d.despesa]));
  const pct = (v: number) => `${Math.max(0, (v / max) * 100)}%`;

  return (
    <div>
      <div className="flex items-end justify-between gap-2" style={{ height: 56 }}>
        {data.map((d, i) => (
          <div key={i} className="flex h-full flex-1 items-end justify-center gap-0.5">
            <div
              className="w-1.5 rounded-sm"
              style={{ height: pct(d.receita), backgroundColor: "var(--status-success)" }}
              title={`Receita: ${d.receita.toLocaleString("pt-BR")}`}
            />
            <div
              className="w-1.5 rounded-sm"
              style={{ height: pct(d.despesa), backgroundColor: "var(--status-critical)" }}
              title={`Despesa: ${d.despesa.toLocaleString("pt-BR")}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between">
        {data.map((d, i) => (
          <span key={i} className="flex-1 text-center text-[9px] uppercase text-ink-muted">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}
