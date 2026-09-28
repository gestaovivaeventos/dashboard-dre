import assert from "node:assert/strict";
import { test } from "node:test";

import {
  csvCell,
  describeUserAgent,
  filterRange,
  parseAccessLogFilters,
  parseAccessLogPage,
  todayInBrasilia,
} from "@/lib/auth/access-log";

const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const EDGE_WIN = `${CHROME_WIN} Edg/129.0.0.0`;
const SAFARI_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0";

test("describeUserAgent: navegadores e sistemas comuns", () => {
  assert.equal(describeUserAgent(CHROME_WIN), "Chrome no Windows");
  assert.equal(describeUserAgent(EDGE_WIN), "Edge no Windows");
  assert.equal(describeUserAgent(SAFARI_IOS), "Safari no iOS");
  assert.equal(describeUserAgent(SAFARI_MAC), "Safari no macOS");
  assert.equal(describeUserAgent(CHROME_ANDROID), "Chrome no Android");
  assert.equal(describeUserAgent(FIREFOX_LINUX), "Firefox no Linux");
});

test("describeUserAgent: não reconhecido vira Outro", () => {
  assert.equal(describeUserAgent(null), "Outro");
  assert.equal(describeUserAgent(""), "Outro");
  assert.equal(describeUserAgent("node"), "Outro");
  assert.equal(describeUserAgent("curl/8.4.0"), "Outro");
});

test("parseAccessLogFilters: padrão são os últimos 30 dias até hoje (Brasília)", () => {
  const f = parseAccessLogFilters({});
  assert.equal(f.to, todayInBrasilia());
  const days = (Date.parse(f.to) - Date.parse(f.from)) / 86_400_000;
  assert.equal(days, 29);
  assert.equal(f.userId, null);
  assert.equal(f.event, null);
});

test("parseAccessLogFilters: descarta valores inválidos", () => {
  const f = parseAccessLogFilters({
    de: "2026-09-01",
    ate: "2026-09-10",
    usuario: "x,id.not.is.null",
    tipo: "delete",
  });
  assert.equal(f.from, "2026-09-01");
  assert.equal(f.to, "2026-09-10");
  assert.equal(f.userId, null);
  assert.equal(f.event, null);
});

test("parseAccessLogFilters: início depois do fim vira um dia só", () => {
  const f = parseAccessLogFilters(new URLSearchParams("de=2026-09-20&ate=2026-09-10&tipo=logout"));
  assert.equal(f.from, "2026-09-10");
  assert.equal(f.to, "2026-09-10");
  assert.equal(f.event, "logout");
});

test("filterRange: dias inteiros em Brasília, fim exclusivo", () => {
  const r = filterRange({ from: "2026-09-01", to: "2026-09-30", userId: null, event: null });
  assert.equal(r.start, "2026-09-01T00:00:00-03:00");
  assert.equal(r.end, "2026-10-01T00:00:00-03:00");
});

test("parseAccessLogPage: mínimo 1", () => {
  assert.equal(parseAccessLogPage({}), 1);
  assert.equal(parseAccessLogPage({ pagina: "3" }), 3);
  assert.equal(parseAccessLogPage({ pagina: "0" }), 1);
  assert.equal(parseAccessLogPage({ pagina: "abc" }), 1);
});

test("csvCell: aspas, separador e fórmula", () => {
  assert.equal(csvCell(null), "");
  assert.equal(csvCell("João"), "João");
  assert.equal(csvCell("a;b"), '"a;b"');
  assert.equal(csvCell('diz "oi"'), '"diz ""oi"""');
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
});
