"use client";

// Evolução do caixa: uma série (o total das contas que a tabela está mostrando),
// um ponto por dia, com carry-forward feito no banco (caixa_history).
//
// Segue o gráfico de saldo do VB (mesma lib, mesmo hue) e as regras da
// visualização: uma série não tem legenda (o título já diz o que é), linha de
// 2px, área a ~10%, grade em hairline sólida e recessiva, crosshair com
// tooltip, texto sempre em tokens de tinta — nunca na cor da série.
//
// O gráfico obedece a QUALQUER filtro da tabela porque recebe os ids visíveis
// e manda exatamente esses ao servidor. Mudou o filtro, mudou a curva.

import { useEffect, useMemo, useRef, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { CaixaHistoryPoint } from "@/lib/caixa/types";
import { compactBRL } from "@/lib/vb/format";

/** Mesmo hue do "Evolução do saldo" do VB — é o mesmo conceito no produto. */
const SERIES = "#0d9488";

const RANGES = [
  { days: 30, label: "30 dias" },
  { days: 90, label: "90 dias" },
  { days: 180, label: "6 meses" },
  { days: 365, label: "1 ano" },
] as const;

type Days = (typeof RANGES)[number]["days"];

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

function dayLabel(isoDay: string): string {
  const [, m, d] = isoDay.split("-");
  return `${d}/${m}`;
}

function dayLong(isoDay: string): string {
  const [y, m, d] = isoDay.split("-");
  return `${d}/${m}/${y}`;
}

interface Props {
  /** Contas visíveis na tabela — o recorte do gráfico. */
  accountIds: string[];
  /** Quantas contas há ao todo, para o subtítulo dizer se é recorte. */
  totalAccounts: number;
}

export function CaixaHistoryChart({ accountIds, totalAccounts }: Props) {
  const [days, setDays] = useState<Days>(90);
  const [points, setPoints] = useState<CaixaHistoryPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Chave estável do recorte: ordenar tira a dependência da ordenação da
  // tabela (reordenar colunas não é mudar o recorte).
  const idsKey = useMemo(() => accountIds.slice().sort().join(","), [accountIds]);
  const requestSeq = useRef(0);

  useEffect(() => {
    if (accountIds.length === 0) {
      setPoints([]);
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    // Debounce: o usuário mexe em vários filtros seguidos; uma ida ao
    // servidor por parada, não por clique.
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/caixa/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountIds: idsKey.split(","), days }),
        });
        const payload = await res.json();
        if (seq !== requestSeq.current) return; // resposta velha
        if (!res.ok) throw new Error(payload?.error ?? "Falha ao carregar o histórico.");
        setPoints(payload.points as CaixaHistoryPoint[]);
        setError(null);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setError(err instanceof Error ? err.message : "Falha ao carregar o histórico.");
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
    // idsKey já representa accountIds; incluir os dois dispararia duas vezes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, days]);

  const data = useMemo(
    () => (points ?? []).map((p) => ({ ...p, label: dayLabel(p.day) })),
    [points],
  );

  const first = data[0];
  const last = data[data.length - 1];
  const delta = first && last && data.length >= 2 ? last.total - first.total : null;
  const deltaPct =
    delta !== null && first && Math.abs(first.total) >= 0.01 ? (delta / Math.abs(first.total)) * 100 : null;

  const recorte = accountIds.length === totalAccounts ? "todas as contas" : `${accountIds.length} conta(s) filtradas`;

  return (
    <section className="rounded-viva-lg border border-border bg-surface-1 p-3">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-ink-primary">Evolução do caixa</h2>
          <p className="text-xs text-ink-muted">
            Soma de {recorte}, um ponto por dia
            {delta !== null && last && (
              <>
                {" · "}
                <span
                  className={`inline-flex items-center gap-0.5 ${
                    delta < 0 ? "text-status-critical" : delta > 0 ? "text-status-success" : ""
                  }`}
                >
                  {delta < 0 ? <TrendingDown className="h-3 w-3" /> : delta > 0 ? <TrendingUp className="h-3 w-3" /> : null}
                  {delta === 0 ? "sem variação" : `${delta > 0 ? "+" : "−"}${brl(Math.abs(delta))}`}
                  {deltaPct !== null && delta !== 0 && ` (${deltaPct > 0 ? "+" : ""}${deltaPct.toFixed(1)}%)`}
                </span>{" "}
                desde {dayLong(first!.day)}
              </>
            )}
          </p>
        </div>

        {/* Controle de período: uma linha, acima do gráfico. */}
        <div className="flex items-center gap-0.5 rounded-viva-md border border-border bg-surface-0 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              onClick={() => setDays(r.days)}
              className={`rounded-viva-sm px-2 py-1 text-xs transition-colors ${
                days === r.days
                  ? "bg-surface-3 font-medium text-ink-primary"
                  : "text-ink-muted hover:text-ink-secondary"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="py-8 text-center text-xs text-status-warning">{error}</p>
      ) : points === null || (loading && data.length === 0) ? (
        <div className="h-[200px] animate-pulse rounded-viva-md bg-surface-2" />
      ) : data.length < 2 ? (
        <div className="flex h-[200px] items-center justify-center px-4 text-center text-xs text-ink-muted">
          {data.length === 0
            ? "Ainda não há histórico para este recorte."
            : `O histórico começa em ${dayLong(data[0].day)} — o gráfico ganha forma a partir do segundo dia de captura.`}
        </div>
      ) : (
        <div
          aria-label={`Evolução do caixa, ${recorte}, últimos ${days} dias`}
          className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}
        >
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="caixaFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES} stopOpacity={0.16} />
                  <stop offset="100%" stopColor={SERIES} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              {/* Grade: hairline sólida e recessiva, só horizontal. */}
              {/* --border é "H S% L%" (shadcn), por isso o hsl(); os outros tokens já são cor. */}
              <CartesianGrid stroke="hsl(var(--border))" strokeWidth={1} vertical={false} />
              <XAxis
                dataKey="label"
                interval="preserveStartEnd"
                minTickGap={48}
                tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tickFormatter={(v) => compactBRL(Number(v))}
                width={72}
                tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                tickLine={false}
                axisLine={false}
                domain={["auto", "auto"]}
              />
              <Tooltip
                cursor={{ stroke: "var(--text-disabled)", strokeWidth: 1 }}
                content={({ active, payload }) => {
                  const p = payload?.[0]?.payload as (CaixaHistoryPoint & { label: string }) | undefined;
                  if (!active || !p) return null;
                  return (
                    <div className="rounded-viva-md border border-border bg-surface-1 px-2.5 py-1.5 text-xs shadow-viva-md">
                      <div className="text-ink-muted">{dayLong(p.day)}</div>
                      <div className="flex items-center gap-1.5 font-semibold tabular-nums text-ink-primary">
                        <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: SERIES }} />
                        {brl(p.total)}
                      </div>
                      {p.contas < accountIds.length && (
                        <div className="text-ink-muted">{p.contas} de {accountIds.length} contas com dado</div>
                      )}
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="total"
                stroke={SERIES}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                fill="url(#caixaFill)"
                dot={false}
                activeDot={{ r: 4, fill: SERIES, stroke: "var(--surface-1)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
              {/* Marcador no último ponto: é o valor de hoje, o que o leitor procura. */}
              {last && (
                <ReferenceDot
                  x={last.label}
                  y={last.total}
                  r={4}
                  fill={SERIES}
                  stroke="var(--surface-1)"
                  strokeWidth={2}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
