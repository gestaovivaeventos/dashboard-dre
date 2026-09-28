import type { SupabaseClient } from "@supabase/supabase-js";

import type { AuthAccessEvent, AuthAccessLogRow } from "@/lib/supabase/types";
import { isUuid } from "@/lib/utils/uuid";

// Log de acesso (tabela auth_access_log, gravada por gatilho em auth.sessions —
// migration 20260930120000). Lógica compartilhada entre a tela /admin/acessos
// e a exportação CSV, para as duas aplicarem exatamente os mesmos filtros.

export const ACCESS_LOG_PAGE_SIZE = 50;
export const ACCESS_LOG_DEFAULT_DAYS = 30;

// Brasil não tem horário de verão desde 2019: o dia em Brasília é sempre UTC-3.
const BR_OFFSET = "-03:00";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface AccessLogFilters {
  /** Primeiro dia (YYYY-MM-DD, Brasília), inclusivo. */
  from: string;
  /** Último dia (YYYY-MM-DD, Brasília), inclusivo. */
  to: string;
  userId: string | null;
  event: AuthAccessEvent | null;
}

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

function readParam(params: RawParams, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export function todayInBrasilia(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function addDays(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function parseAccessLogFilters(params: RawParams): AccessLogFilters {
  const today = todayInBrasilia();
  const rawTo = readParam(params, "ate");
  const rawFrom = readParam(params, "de");
  const to = rawTo && DATE_RE.test(rawTo) ? rawTo : today;
  let from =
    rawFrom && DATE_RE.test(rawFrom) ? rawFrom : addDays(to, -(ACCESS_LOG_DEFAULT_DAYS - 1));
  if (from > to) from = to;

  const rawUser = readParam(params, "usuario");
  const rawEvent = readParam(params, "tipo");

  return {
    from,
    to,
    userId: rawUser && isUuid(rawUser) ? rawUser : null,
    event: rawEvent === "login" || rawEvent === "logout" ? rawEvent : null,
  };
}

export function parseAccessLogPage(params: RawParams): number {
  const n = Number.parseInt(readParam(params, "pagina") ?? "1", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Intervalo [start, end) em timestamptz cobrindo os dias do filtro em Brasília. */
export function filterRange(filters: AccessLogFilters): { start: string; end: string } {
  return {
    start: `${filters.from}T00:00:00${BR_OFFSET}`,
    end: `${addDays(filters.to, 1)}T00:00:00${BR_OFFSET}`,
  };
}

export const ACCESS_LOG_COLUMNS =
  "id,user_id,email,event,session_id,ip,user_agent,aal,source,occurred_at";

export function accessLogQuery(db: SupabaseClient, filters: AccessLogFilters, count = false) {
  const { start, end } = filterRange(filters);
  let query = db
    .from("auth_access_log")
    .select(ACCESS_LOG_COLUMNS, count ? { count: "exact" } : undefined)
    .gte("occurred_at", start)
    .lt("occurred_at", end);
  if (filters.userId) query = query.eq("user_id", filters.userId);
  if (filters.event) query = query.eq("event", filters.event);
  return query.order("occurred_at", { ascending: false }).order("id", { ascending: false });
}

export interface AccessLogSummary {
  total: number;
  uniqueUsers: number;
  lastAt: string | null;
}

export async function fetchAccessLogSummary(
  db: SupabaseClient,
  filters: AccessLogFilters,
): Promise<AccessLogSummary> {
  const { start, end } = filterRange(filters);
  const { data, error } = await db.rpc("auth_access_log_summary", {
    p_from: start,
    p_to: end,
    p_user_id: filters.userId,
    p_event: filters.event,
  });
  if (error) throw new Error(`auth_access_log_summary failed: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as
    | { total: number | string; unique_users: number | string; last_at: string | null }
    | undefined;
  return {
    total: Number(row?.total ?? 0),
    uniqueUsers: Number(row?.unique_users ?? 0),
    lastAt: row?.last_at ?? null,
  };
}

/** Todas as linhas do filtro, em lotes (o PostgREST limita cada resposta). */
export async function fetchAllAccessLogRows(
  db: SupabaseClient,
  filters: AccessLogFilters,
): Promise<AuthAccessLogRow[]> {
  const batch = 1000;
  const rows: AuthAccessLogRow[] = [];
  for (let offset = 0; ; offset += batch) {
    const { data, error } = await accessLogQuery(db, filters).range(offset, offset + batch - 1);
    if (error) throw new Error(`auth_access_log export failed: ${error.message}`);
    const chunk = (data ?? []) as AuthAccessLogRow[];
    rows.push(...chunk);
    if (chunk.length < batch) return rows;
  }
}

export const ACCESS_EVENT_LABEL: Record<AuthAccessEvent, string> = {
  login: "Entrada",
  // O Supabase também encerra a sessão sozinho quando ela expira, não só no Sair.
  logout: "Sessão encerrada",
};

export const ACCESS_SOURCE_LABEL: Record<AuthAccessLogRow["source"], string> = {
  trigger: "Registro automático",
  backfill: "Importado",
};

export function formatBrasiliaDateTime(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}

/** "Chrome no Windows". O que não for reconhecido vira "Outro". */
export function describeUserAgent(ua: string | null): string {
  if (!ua) return "Outro";

  let browser: string | null = null;
  if (/Edg(e|A|iOS)?\//.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/.test(ua)) browser = "Opera";
  else if (/SamsungBrowser\//.test(ua)) browser = "Samsung Internet";
  else if (/Firefox\/|FxiOS\//.test(ua)) browser = "Firefox";
  else if (/Chrome\/|CriOS\//.test(ua)) browser = "Chrome";
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = "Safari";

  let os: string | null = null;
  if (/Windows/.test(ua)) os = "Windows";
  else if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Mac OS X|Macintosh/.test(ua)) os = "macOS";
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Linux/.test(ua)) os = "Linux";

  if (!browser && !os) return "Outro";
  return os ? `${browser ?? "Outro"} no ${os}` : (browser as string);
}

/** Célula do CSV (separador `;`). */
export function csvCell(value: string | null | undefined): string {
  let text = value ?? "";
  // Neutraliza fórmula: o Excel executaria uma célula que começa com = + - @.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
