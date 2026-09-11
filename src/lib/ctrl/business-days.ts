// Calendário bancário brasileiro + regra de cutoff de meio-dia (horário de
// Brasília) para a data de vencimento das requisições.
//
// Regra: pagamentos solicitados ATÉ o meio-dia (12:00:00) no horário de
// Brasília podem vencer no mesmo dia; APÓS o meio-dia, só a partir do próximo
// dia útil. "Dia útil" = não é fim de semana nem feriado bancário nacional
// (fixos + móveis derivados da Páscoa: Sexta-feira Santa, Carnaval seg/ter,
// Corpus Christi).
//
// Datas trafegam como string ISO "YYYY-MM-DD" (mesmo formato do <input type=date>
// e da coluna due_date). Aritmética em UTC para evitar deslize de fuso.

const DAY_MS = 86_400_000;

function isoToUtc(ymd: string): Date {
  return new Date(ymd + "T00:00:00Z");
}
function utcToIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDaysIso(ymd: string, n: number): string {
  return utcToIso(new Date(isoToUtc(ymd).getTime() + n * DAY_MS));
}

// Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano).
function easterSundayIso(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = março, 4 = abril
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utcToIso(new Date(Date.UTC(year, month - 1, day)));
}

const FIXED_HOLIDAYS = [
  "01-01", // Confraternização Universal
  "04-21", // Tiradentes
  "05-01", // Dia do Trabalho
  "09-07", // Independência
  "10-12", // Nossa Senhora Aparecida
  "11-02", // Finados
  "11-15", // Proclamação da República
  "11-20", // Consciência Negra (nacional desde 2024)
  "12-25", // Natal
];

const holidayCache = new Map<number, Set<string>>();

function holidaysForYear(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;

  const set = new Set<string>(FIXED_HOLIDAYS.map((md) => `${year}-${md}`));
  const easter = easterSundayIso(year);
  set.add(addDaysIso(easter, -2)); // Sexta-feira Santa
  set.add(addDaysIso(easter, -48)); // Segunda de Carnaval
  set.add(addDaysIso(easter, -47)); // Terça de Carnaval
  set.add(addDaysIso(easter, 60)); // Corpus Christi

  holidayCache.set(year, set);
  return set;
}

export function isBusinessDay(ymd: string): boolean {
  const dow = isoToUtc(ymd).getUTCDay(); // 0 = domingo, 6 = sábado
  if (dow === 0 || dow === 6) return false;
  return !holidaysForYear(Number(ymd.slice(0, 4))).has(ymd);
}

// Primeiro dia útil >= a data informada (a própria data, se já for útil).
export function businessDayOnOrAfter(ymd: string): string {
  let d = ymd;
  while (!isBusinessDay(d)) d = addDaysIso(d, 1);
  return d;
}

// Partes do "agora" no fuso de Brasília, independente do fuso do runtime
// (servidor em UTC ou navegador em qualquer fuso).
function brtParts(date: Date): { ymd: string; hour: number; minute: number; second: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    ymd: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

// Data mínima de vencimento (ISO YYYY-MM-DD) conforme a regra do cutoff de
// meio-dia em Brasília. `date` default = agora; injetável para testes.
export function earliestDueDateBRT(date: Date = new Date()): string {
  const { ymd, hour, minute, second } = brtParts(date);
  // "até meio-dia" inclui 12:00:00; a partir de 12:00:01 é "após meio-dia".
  const afterNoon = hour > 12 || (hour === 12 && (minute > 0 || second > 0));
  const start = afterNoon ? addDaysIso(ymd, 1) : ymd;
  return businessDayOnOrAfter(start);
}

// dd/mm/yyyy a partir de "YYYY-MM-DD" (para mensagens ao usuário).
export function formatBR(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}
