// Data/hora do Control Hub — SEMPRE no fuso de Brasília.
//
// Os carimbos (`created_at`, `approved_at`, `sent_to_payment_at`, histórico de
// ações…) são gravados em UTC (TIMESTAMPTZ + now()/toISOString()). Formatar com
// `toLocaleString("pt-BR")` sem `timeZone` usa o fuso de quem renderiza — o
// servidor da Vercel roda em UTC e o navegador do usuário pode estar em
// qualquer fuso —, e o histórico aparecia 3 horas adiantado. Todas as telas do
// Control Hub devem usar estes helpers em vez de formatar direto.
//
// Colunas de DATA pura (`due_date`, 'YYYY-MM-DD') não têm hora nem fuso: use
// `formatDayBR`, que só reordena os campos e nunca converte fuso (converter
// deslocaria o vencimento em um dia).

export const BRASILIA_TZ = "America/Sao_Paulo";

const EMPTY = "—";

// Interpreta o carimbo do banco como instante. Quando a string não traz fuso
// ("2026-08-04T12:00:00", sem Z nem ±hh:mm) o valor veio de um TIMESTAMP sem
// fuso gravado em UTC — assumir o fuso local do runtime erraria de novo, então
// tratamos como UTC explicitamente.
function parseInstant(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const raw = value.trim();
  if (!raw) return null;

  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const hasTime = raw.includes("T") || raw.includes(" ");
  const normalized = hasTime && !hasZone ? `${raw.replace(" ", "T")}Z` : raw;

  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatParts(
  d: Date,
  options: Intl.DateTimeFormatOptions,
): Record<string, string> {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: BRASILIA_TZ,
    ...options,
  }).formatToParts(d);
  const out: Record<string, string> = {};
  for (const p of parts) out[p.type] = p.value;
  return out;
}

/** Carimbo completo em Brasília: "04/08/2026 09:32" (ou com segundos). */
export function formatDateTimeBR(
  value: string | Date | null | undefined,
  opts: { seconds?: boolean; fallback?: string } = {},
): string {
  const d = parseInstant(value);
  if (!d) return opts.fallback ?? EMPTY;
  const p = formatParts(d, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(opts.seconds ? { second: "2-digit" } : {}),
    hour12: false,
  });
  const time = opts.seconds
    ? `${p.hour}:${p.minute}:${p.second}`
    : `${p.hour}:${p.minute}`;
  return `${p.day}/${p.month}/${p.year} ${time}`;
}

/** Só o dia do carimbo, contado em Brasília: "04/08/2026". */
export function formatDateBR(
  value: string | Date | null | undefined,
  opts: { fallback?: string } = {},
): string {
  const d = parseInstant(value);
  if (!d) return opts.fallback ?? EMPTY;
  const p = formatParts(d, { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${p.day}/${p.month}/${p.year}`;
}

/**
 * Coluna de data pura ('YYYY-MM-DD', ex.: vencimento) → "04/08/2026".
 * Sem conversão de fuso: o dia gravado é o dia exibido.
 */
export function formatDayBR(
  value: string | null | undefined,
  opts: { fallback?: string } = {},
): string {
  const fallback = opts.fallback ?? EMPTY;
  if (!value) return fallback;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return fallback;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Dia do carimbo em Brasília no formato 'YYYY-MM-DD' — para ordenar e comparar
 * com filtros de período (`iso.slice(0, 10)` daria o dia em UTC, jogando o que
 * foi criado à noite para o dia seguinte).
 */
export function dayKeyBR(value: string | Date | null | undefined): string {
  const d = parseInstant(value);
  if (!d) return "";
  const p = formatParts(d, { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${p.year}-${p.month}-${p.day}`;
}

/** Hoje em Brasília no formato 'YYYY-MM-DD' (para comparar com colunas DATE). */
export function todayBR(): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: BRASILIA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Ano corrente em Brasília. No servidor (UTC), 31/12 após 21h já seria o ano seguinte. */
export function currentYearBR(): number {
  return Number(todayBR().slice(0, 4));
}

/** Mês corrente em Brasília (1-12). */
export function currentMonthBR(): number {
  return Number(todayBR().slice(5, 7));
}
