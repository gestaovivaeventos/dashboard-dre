# VB — Rendimento automático por CDI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O saldo de cada credor do VB passa a render 100% do CDI diário do Banco Central, com um botão que mostra a prévia e lança os rendimentos.

**Architecture:** O CDI diário (série 12 do SGS/BCB) é baixado por um cron e guardado em `vb_cdi_rates`. Um motor puro reconstrói a linha do tempo de lançamentos de cada credor, corta em segmentos de saldo parado e aplica o produto das taxas do intervalo. As server actions calculam a prévia e gravam; a gravação recalcula no servidor, nunca confia no cliente.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Supabase (Postgres + RLS, service role), zod v4, shadcn/ui + Tailwind, node test runner via tsx (`npm test`).

**Spec:** `docs/superpowers/specs/2026-09-11-vb-cdi-rendimento-design.md`

## Global Constraints

- Fonte: `https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=DD/MM/YYYY&dataFinal=DD/MM/YYYY`. Resposta `[{"data":"10/09/2026","valor":"0.051660"}]`; `valor` é **percentual ao dia**. **HTTP 404 significa "nenhuma taxa no intervalo" e deve virar lista vazia, nunca erro.** Só existem dias úteis na série.
- `VB_CDI_START_DATE = "2026-09-10"` (marco zero; nenhum dia anterior rende). `VB_CDI_SGS_SERIES = 12`. `VB_CDI_DESCRIPTION = "Rendimento CDI"`.
- **Intervalo meio aberto:** o rendimento de `(start, end]` usa as taxas `d` com `start < d <= end`; `days = end − start`.
- Ponto de partida de um credor: último `period_end` de rendimento com `rate_basis='cdi'`; sem nenhum, `VB_CDI_START_DATE`. Fim: maior data em `vb_cdi_rates`, nunca hoje.
- Só **saldo positivo** rende; saldo ≤ 0 ou fator 1 não geram lançamento. Credor com `active = false` fica de fora.
- O lançamento gerado é `kind='rendimento'`, `status='aprovado'`, `entry_date = period_end`, `rate = fator − 1`, `rate_basis='cdi'`, `description = "Rendimento CDI"`.
- **O motor é independente de ordem**: reconstrói segmentos a partir dos lançamentos. Lançar um movimento sem fechar o rendimento antes não corrompe o cálculo seguinte.
- Lançamento com `entry_date` anterior ao ponto de partida **não** dispara recálculo: devolve aviso `retroativo`.
- Toda leitura e escrita usa `createAdminClient()` depois de `requireVbGestor()` (ou do gate de gestor na página / do `CRON_SECRET` no cron). Nenhuma função `SECURITY DEFINER` nova.
- Dinheiro em centavos via `roundCents` de `@/lib/vb/money`. Sem `downlevelIteration`: nunca espalhe iteradores de Map/Set (`Array.from(...)`).
- Textos ao usuário em português; mensagens técnicas em inglês. A interface nunca mostra a palavra "planilha".
- **Não rode `npm run build`** (o dev server do dono pode estar de pé). Valide com `npx tsc --noEmit`, `npm run lint`, `npm test`.
- A migration é aplicada pelo controlador via MCP do Supabase (projeto `hlophikvgtqoexqwxxis`); o implementador só cria o arquivo.
- Commits em português com o trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260911140000_vb_cdi_rates.sql` | Tabela `vb_cdi_rates` + RLS de leitura. |
| `src/lib/vb/cdi/config.ts` | Constantes do regime de CDI. |
| `src/lib/vb/cdi/accrual.ts` + `accrual.test.ts` | Motor puro: fator acumulado e segmentos de saldo parado. |
| `src/lib/vb/cdi/bcb.ts` + `bcb.test.ts` | Fronteira com o Banco Central: parsing e tratamento do 404. |
| `src/lib/vb/cdi/queries.ts` | Leituras: taxas, última data, ponto de partida por credor. |
| `src/lib/vb/cdi/sync.ts` | Busca e grava as taxas que faltam. |
| `src/lib/vb/actions/cdi.ts` | Server actions: prévia, gravação e fechamento antes do lançamento manual. |
| `src/app/api/cron/vb-cdi/route.ts` + `vercel.json` | Cron diário que só baixa taxas. |
| `src/components/vb/cdi-accrual-dialog.tsx` | Botão + diálogo de prévia. |
| `src/app/(vb)/vb/page.tsx` | Coloca o botão na Visão geral. |
| `src/lib/vb/actions/entries.ts` | Fecha o rendimento antes de gravar o lançamento manual. |
| `scripts/vb-cdi-check.ts` | Confere o motor contra um período já fechado do histórico. |
| `CLAUDE.md` | Parágrafo "Rendimento por CDI" na seção do VB. |

---

### Task 1: Migration, constantes e o motor puro

**Files:**
- Create: `supabase/migrations/20260911140000_vb_cdi_rates.sql`
- Create: `src/lib/vb/cdi/config.ts`
- Create: `src/lib/vb/cdi/accrual.ts`
- Test: `src/lib/vb/cdi/accrual.test.ts`

**Interfaces:**
- Consumes: `LedgerEntryLike` e `sortLedger` de `@/lib/vb/ledger`; `roundCents` de `@/lib/vb/money`.
- Produces:
  - `VB_CDI_SGS_SERIES`, `VB_CDI_START_DATE`, `VB_CDI_DESCRIPTION`
  - `interface AccrualSegment { period_start: string; period_end: string; days: number; balance: number; factor: number; rate: number; amount: number }`
  - `accumulatedFactor(rates: ReadonlyMap<string, number>, after: string, until: string): number`
  - `planAccrual(input: { entries: readonly LedgerEntryLike[]; rates: ReadonlyMap<string, number>; from: string; until: string }): AccrualSegment[]`

- [ ] **Step 1: Criar a migration** (só o arquivo; quem aplica é o controlador)

```sql
-- supabase/migrations/20260911140000_vb_cdi_rates.sql
-- CDI diário do Banco Central (série 12 do SGS), um registro por dia útil.
-- Guardado em vez de consultado na hora para o cálculo ser reproduzível e
-- auditável, e para o dia em que o BCB estiver fora do ar não travar nada.
CREATE TABLE IF NOT EXISTS public.vb_cdi_rates (
  rate_date  DATE PRIMARY KEY,
  -- Percentual ao dia, como o BCB publica: 0.051660 = 0,05166% a.d.
  rate       NUMERIC(12,8) NOT NULL CHECK (rate >= 0),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.vb_cdi_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vb_cdi_rates_select ON public.vb_cdi_rates;
CREATE POLICY vb_cdi_rates_select ON public.vb_cdi_rates
  FOR SELECT TO authenticated USING (public.vb_role() IS NOT NULL);
-- Sem policy de escrita: só o service role grava.

COMMENT ON TABLE public.vb_cdi_rates IS
  'CDI diário (série 12 do SGS/BCB) usado para o rendimento automático do VB.';
```

- [ ] **Step 2: Criar as constantes**

```ts
// src/lib/vb/cdi/config.ts
// Regime de rendimento por CDI do VB. Sem retroativo: nada anterior ao marco
// zero rende, porque o histórico importado já fechou os períodos até ali.

/** Série do SGS/BCB: CDI diário, percentual ao dia. */
export const VB_CDI_SGS_SERIES = 12;

/**
 * Marco zero ('YYYY-MM-DD'): última data com CDI publicado quando o regime
 * entrou. Pelo intervalo meio aberto, o primeiro dia que rende é o seguinte.
 */
export const VB_CDI_START_DATE = "2026-09-10";

/** Descrição dos lançamentos gerados. */
export const VB_CDI_DESCRIPTION = "Rendimento CDI";
```

- [ ] **Step 3: Escrever os testes do motor (falham: módulo não existe)**

```ts
// src/lib/vb/cdi/accrual.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { accumulatedFactor, planAccrual } from "@/lib/vb/cdi/accrual";
import type { LedgerEntryLike } from "@/lib/vb/ledger";

/** 0,05% ao dia em todos os dias úteis de 11 a 18/09/2026 (13 e 14 são fim de semana). */
const RATES = new Map<string, number>([
  ["2026-09-11", 0.05],
  ["2026-09-15", 0.05],
  ["2026-09-16", 0.05],
  ["2026-09-17", 0.05],
  ["2026-09-18", 0.05],
]);

function entry(id: string, entry_date: string, amount: number, sort_order = 0): LedgerEntryLike {
  return { id, entry_date, amount, kind: amount >= 0 ? "entrada" : "saida", sort_order, created_at: "2026-09-01T00:00:00Z" };
}

test("accumulatedFactor multiplica só as taxas do intervalo meio aberto", () => {
  // (10/09, 11/09] = um dia útil.
  assert.equal(accumulatedFactor(RATES, "2026-09-10", "2026-09-11").toFixed(8), (1.0005).toFixed(8));
  // (11/09, 18/09] = 15, 16, 17 e 18 — o 11 já foi contado no período anterior.
  assert.equal(accumulatedFactor(RATES, "2026-09-11", "2026-09-18").toFixed(8), Math.pow(1.0005, 4).toFixed(8));
  // Intervalo sem dia útil não rende.
  assert.equal(accumulatedFactor(RATES, "2026-09-11", "2026-09-14"), 1);
  // Fim antes do início não rende.
  assert.equal(accumulatedFactor(RATES, "2026-09-18", "2026-09-11"), 1);
});

test("planAccrual: saldo parado o período inteiro vira um lançamento só", () => {
  const rows = planAccrual({
    entries: [entry("a", "2026-09-01", 100000)],
    rates: RATES,
    from: "2026-09-10",
    until: "2026-09-18",
  });
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.period_start, "2026-09-10");
  assert.equal(row.period_end, "2026-09-18");
  assert.equal(row.days, 8);
  assert.equal(row.balance, 100000);
  // Cinco dias úteis: 11, 15, 16, 17 e 18.
  assert.equal(row.rate.toFixed(8), (Math.pow(1.0005, 5) - 1).toFixed(8));
  assert.equal(row.amount, 250.25);
});

test("planAccrual: cada lançamento no meio do caminho quebra o período", () => {
  const rows = planAccrual({
    entries: [entry("a", "2026-09-01", 100000), entry("b", "2026-09-16", 50000)],
    rates: RATES,
    from: "2026-09-10",
    until: "2026-09-18",
  });
  assert.deepEqual(
    rows.map((r) => [r.period_start, r.period_end, r.balance]),
    [
      ["2026-09-10", "2026-09-16", 100000],
      // 100.000 + 150,08 de rendimento do primeiro período + os 50.000 do dia 16.
      ["2026-09-16", "2026-09-18", 150150.08],
    ],
  );
  assert.equal(rows[0].amount, 150.08);
  assert.equal(rows[1].amount, 150.19);
  // O dia 16 entra só no primeiro período; o segundo pega 17 e 18.
  assert.equal(rows[0].rate.toFixed(8), (Math.pow(1.0005, 3) - 1).toFixed(8));
  assert.equal(rows[1].rate.toFixed(8), (Math.pow(1.0005, 2) - 1).toFixed(8));
});

test("planAccrual: o rendimento de um período rende no seguinte (juros sobre juros)", () => {
  const rows = planAccrual({
    entries: [entry("a", "2026-09-01", 100000), entry("b", "2026-09-16", 0.01)],
    rates: RATES,
    from: "2026-09-10",
    until: "2026-09-18",
  });
  // 100.000 + 150,08 do primeiro período + o centavo lançado no dia 16.
  assert.equal(rows[1].balance, 100150.09);
});

test("planAccrual: saldo negativo e saldo zero não geram lançamento", () => {
  assert.deepEqual(
    planAccrual({ entries: [entry("a", "2026-09-01", -5000)], rates: RATES, from: "2026-09-10", until: "2026-09-18" }),
    [],
  );
  assert.deepEqual(
    planAccrual({ entries: [], rates: RATES, from: "2026-09-10", until: "2026-09-18" }),
    [],
  );
});

test("planAccrual: período sem taxa publicada não gera lançamento", () => {
  assert.deepEqual(
    planAccrual({ entries: [entry("a", "2026-09-01", 100000)], rates: RATES, from: "2026-09-11", until: "2026-09-14" }),
    [],
  );
});

test("planAccrual é idempotente: partir do fim do período gerado não produz nada", () => {
  const first = planAccrual({
    entries: [entry("a", "2026-09-01", 100000)],
    rates: RATES,
    from: "2026-09-10",
    until: "2026-09-18",
  });
  const again = planAccrual({
    entries: [entry("a", "2026-09-01", 100000)],
    rates: RATES,
    from: first[0].period_end,
    until: "2026-09-18",
  });
  assert.deepEqual(again, []);
});

test("planAccrual ignora lançamento anterior ao início, mas soma no saldo", () => {
  const rows = planAccrual({
    entries: [entry("a", "2026-08-01", 40000), entry("b", "2026-09-05", 60000)],
    rates: RATES,
    from: "2026-09-10",
    until: "2026-09-11",
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].balance, 100000, "os dois já estavam no saldo antes do início");
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `node --import tsx --test src/lib/vb/cdi/accrual.test.ts`
Expected: FAIL (Cannot find module '@/lib/vb/cdi/accrual').

- [ ] **Step 5: Implementar o motor**

```ts
// src/lib/vb/cdi/accrual.ts
// Motor do rendimento por CDI. Puro: recebe os lançamentos e as taxas, devolve
// os lançamentos de rendimento que faltam. Nada de banco, nada de rede.
//
// Independente de ordem de propósito: reconstrói os segmentos a partir da
// linha do tempo, então gravar um movimento sem fechar o rendimento antes não
// corrompe o cálculo seguinte — ele simplesmente quebra o período naquela data.

import { sortLedger, type LedgerEntryLike } from "@/lib/vb/ledger";
import { roundCents } from "@/lib/vb/money";

export interface AccrualSegment {
  /** 'YYYY-MM-DD'. O saldo rendeu de (period_start, period_end]. */
  period_start: string;
  period_end: string;
  /** Convenção do histórico: fim − início, em dias corridos. */
  days: number;
  /** Saldo parado durante o período. */
  balance: number;
  /** Produto de (1 + taxa/100) dos dias úteis do intervalo. */
  factor: number;
  /** factor − 1, que é o que vai para vb_entries.rate. */
  rate: number;
  amount: number;
}

const MS_PER_DAY = 86_400_000;

function diffDays(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / MS_PER_DAY);
}

/**
 * Produto de (1 + taxa/100) das datas d com after < d <= until. O dia em que um
 * período fecha é o mesmo em que o próximo abre, e a taxa dele conta uma vez só.
 */
export function accumulatedFactor(
  rates: ReadonlyMap<string, number>,
  after: string,
  until: string,
): number {
  if (until <= after) return 1;
  let factor = 1;
  for (const [date, rate] of Array.from(rates.entries())) {
    if (date > after && date <= until) factor *= 1 + rate / 100;
  }
  return factor;
}

export function planAccrual(input: {
  entries: readonly LedgerEntryLike[];
  rates: ReadonlyMap<string, number>;
  /** Ponto de partida, exclusivo. */
  from: string;
  /** Última data com taxa publicada, inclusiva. */
  until: string;
}): AccrualSegment[] {
  const { rates, from, until } = input;
  if (until <= from) return [];

  const sorted = sortLedger(input.entries);
  // Saldo que já existia no ponto de partida.
  let balance = 0;
  for (const entry of sorted) {
    if (entry.entry_date <= from) balance += entry.amount;
  }

  // Datas de lançamento DENTRO do intervalo abrem um segmento novo.
  const cuts: string[] = [];
  for (const entry of sorted) {
    if (entry.entry_date > from && entry.entry_date <= until && !cuts.includes(entry.entry_date)) {
      cuts.push(entry.entry_date);
    }
  }
  const bounds = [from, ...cuts];
  if (bounds[bounds.length - 1] !== until) bounds.push(until);

  const segments: AccrualSegment[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const period_start = bounds[i];
    const period_end = bounds[i + 1];
    const factor = accumulatedFactor(rates, period_start, period_end);
    const amount = roundCents(balance * (factor - 1));
    if (balance > 0 && factor > 1 && amount > 0) {
      segments.push({
        period_start,
        period_end,
        days: diffDays(period_start, period_end),
        balance: roundCents(balance),
        factor,
        rate: factor - 1,
        amount,
      });
      // O rendimento entra no extrato em period_end e rende no segmento seguinte.
      balance += amount;
    }
    // Os lançamentos datados no fim deste segmento valem do próximo em diante.
    for (const entry of sorted) {
      if (entry.entry_date === period_end) balance += entry.amount;
    }
  }
  return segments;
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `node --import tsx --test src/lib/vb/cdi/accrual.test.ts`
Expected: 8 testes, 0 falhas.

- [ ] **Step 7: Validar e commitar**

Run: `npx tsc --noEmit && npm run lint`

```bash
git add supabase/migrations/20260911140000_vb_cdi_rates.sql src/lib/vb/cdi/config.ts src/lib/vb/cdi/accrual.ts src/lib/vb/cdi/accrual.test.ts
git commit -m "feat(vb): motor do rendimento por CDI (puro) e tabela de taxas

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

### Task 2: Fronteira com o Banco Central e sincronização das taxas

**Files:**
- Create: `src/lib/vb/cdi/bcb.ts`
- Test: `src/lib/vb/cdi/bcb.test.ts`
- Create: `src/lib/vb/cdi/queries.ts`
- Create: `src/lib/vb/cdi/sync.ts`

**Interfaces:**
- Consumes: `VB_CDI_SGS_SERIES`, `VB_CDI_START_DATE` (Task 1); `createAdminClient` de `@/lib/supabase/admin`; `todayBR` de `@/lib/ctrl/datetime`.
- Produces:
  - `interface CdiRate { rate_date: string; rate: number }`
  - `parseCdiPayload(payload: unknown): CdiRate[]` (puro)
  - `toBcbDate(iso: string): string` e `cdiRangeUrl(from: string, to: string): string` (puros)
  - `fetchCdiRange(from: string, to: string): Promise<CdiRate[]>`
  - `loadCdiRates(from: string): Promise<Map<string, number>>`
  - `lastCdiDate(): Promise<string | null>`
  - `accrualStartFor(creditorId: string): Promise<string>`
  - `syncCdiRates(): Promise<{ inserted: number; lastDate: string | null }>`

- [ ] **Step 1: Escrever os testes do parsing (falham: módulo não existe)**

```ts
// src/lib/vb/cdi/bcb.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { cdiRangeUrl, parseCdiPayload, toBcbDate } from "@/lib/vb/cdi/bcb";

test("toBcbDate converte ISO para o formato do Banco Central", () => {
  assert.equal(toBcbDate("2026-09-10"), "10/09/2026");
});

test("cdiRangeUrl monta a consulta da série 12", () => {
  const url = cdiRangeUrl("2026-09-01", "2026-09-10");
  assert.ok(url.includes("bcdata.sgs.12/dados"));
  assert.ok(url.includes("dataInicial=01%2F09%2F2026") || url.includes("dataInicial=01/09/2026"));
  assert.ok(url.includes("dataFinal=10%2F09%2F2026") || url.includes("dataFinal=10/09/2026"));
});

test("parseCdiPayload converte data e valor", () => {
  assert.deepEqual(parseCdiPayload([{ data: "10/09/2026", valor: "0.051660" }]), [
    { rate_date: "2026-09-10", rate: 0.05166 },
  ]);
});

test("parseCdiPayload ignora linhas quebradas em vez de derrubar a rotina", () => {
  const rows = parseCdiPayload([
    { data: "10/09/2026", valor: "0.051660" },
    { data: "sem data", valor: "0.05" },
    { data: "11/09/2026", valor: "abc" },
    { data: "11/09/2026" },
    null,
  ]);
  assert.deepEqual(rows, [{ rate_date: "2026-09-10", rate: 0.05166 }]);
});

test("parseCdiPayload devolve lista vazia para o corpo de erro do BCB", () => {
  // O 404 do SGS vem com este corpo quando não há taxa no intervalo.
  assert.deepEqual(parseCdiPayload({ erro: { statusCode: 404, detail: "Value(s) not found" } }), []);
  assert.deepEqual(parseCdiPayload(null), []);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --import tsx --test src/lib/vb/cdi/bcb.test.ts`
Expected: FAIL (Cannot find module '@/lib/vb/cdi/bcb').

- [ ] **Step 3: Implementar a fronteira com o BCB**

```ts
// src/lib/vb/cdi/bcb.ts
// Fronteira com o SGS do Banco Central. O parsing é separado da rede para ser
// testável sem internet.

import { VB_CDI_SGS_SERIES } from "@/lib/vb/cdi/config";

export interface CdiRate {
  /** 'YYYY-MM-DD' */
  rate_date: string;
  /** Percentual ao dia, como o BCB publica (0.05166 = 0,05166% a.d.). */
  rate: number;
}

const BCB_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/** '2026-09-10' → '10/09/2026'. */
export function toBcbDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function cdiRangeUrl(from: string, to: string): string {
  const url = new URL(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${VB_CDI_SGS_SERIES}/dados`);
  url.searchParams.set("formato", "json");
  url.searchParams.set("dataInicial", toBcbDate(from));
  url.searchParams.set("dataFinal", toBcbDate(to));
  return url.toString();
}

/** Linha quebrada é descartada; corpo de erro do BCB vira lista vazia. */
export function parseCdiPayload(payload: unknown): CdiRate[] {
  if (!Array.isArray(payload)) return [];
  const rows: CdiRate[] = [];
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const record = item as { data?: unknown; valor?: unknown };
    if (typeof record.data !== "string" || typeof record.valor !== "string") continue;
    const match = BCB_DATE.exec(record.data);
    if (!match) continue;
    const rate = Number(record.valor);
    if (!Number.isFinite(rate) || rate < 0) continue;
    rows.push({ rate_date: `${match[3]}-${match[2]}-${match[1]}`, rate });
  }
  return rows;
}

/**
 * Taxas do intervalo. O SGS devolve **404 quando não há taxa no período**
 * (fim de semana, feriado, futuro) — isso é "nada novo", não falha.
 */
export async function fetchCdiRange(from: string, to: string): Promise<CdiRate[]> {
  if (to < from) return [];
  const response = await fetch(cdiRangeUrl(from, to), { cache: "no-store" });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`BCB SGS ${response.status} fetching CDI ${from}..${to}`);
  return parseCdiPayload(await response.json());
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --import tsx --test src/lib/vb/cdi/bcb.test.ts`
Expected: 5 testes, 0 falhas.

- [ ] **Step 5: Escrever as leituras**

```ts
// src/lib/vb/cdi/queries.ts
// Leituras do rendimento por CDI. Sempre pelo admin client, depois do gate de
// gestor (ação/página) ou do CRON_SECRET (cron).

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { VB_CDI_START_DATE } from "@/lib/vb/cdi/config";

/** PostgREST devolve no máximo 1000 linhas por requisição. */
const PAGE = 1000;

/** Taxas de rate_date >= from, indexadas por data. */
export async function loadCdiRates(from: string): Promise<Map<string, number>> {
  const admin = createAdminClient();
  const rates = new Map<string, number>();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin
      .from("vb_cdi_rates")
      .select("rate_date, rate")
      .gte("rate_date", from)
      .order("rate_date")
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ rate_date: string; rate: number | string }>;
    for (const row of rows) rates.set(row.rate_date, Number(row.rate));
    if (rows.length < PAGE) break;
  }
  return rates;
}

/** Maior data com CDI gravado. É até aqui que o rendimento pode ir. */
export async function lastCdiDate(): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("vb_cdi_rates")
    .select("rate_date")
    .order("rate_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { rate_date: string } | null)?.rate_date ?? null;
}

/**
 * Ponto de partida do credor: fim do último rendimento por CDI. Sem nenhum,
 * o marco zero — é o que garante que o passado não é recalculado.
 */
export async function accrualStartFor(creditorId: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("vb_entries")
    .select("period_end")
    .eq("creditor_id", creditorId)
    .eq("status", "aprovado")
    .eq("kind", "rendimento")
    .eq("rate_basis", "cdi")
    .not("period_end", "is", null)
    .order("period_end", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const last = (data as { period_end: string | null } | null)?.period_end ?? null;
  return last && last > VB_CDI_START_DATE ? last : VB_CDI_START_DATE;
}
```

- [ ] **Step 6: Escrever a sincronização**

```ts
// src/lib/vb/cdi/sync.ts
// Busca no Banco Central o CDI que ainda não está gravado e faz upsert.
// Idempotente: parte sempre da última data gravada.

import "server-only";

import { todayBR } from "@/lib/ctrl/datetime";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchCdiRange } from "@/lib/vb/cdi/bcb";
import { VB_CDI_START_DATE } from "@/lib/vb/cdi/config";
import { lastCdiDate } from "@/lib/vb/cdi/queries";

export async function syncCdiRates(): Promise<{ inserted: number; lastDate: string | null }> {
  const stored = await lastCdiDate();
  const from = stored ?? VB_CDI_START_DATE;
  const to = todayBR();
  const rows = await fetchCdiRange(from, to);
  // O intervalo inclui a data já gravada; o upsert por chave primária absorve.
  if (rows.length === 0) return { inserted: 0, lastDate: stored };

  const admin = createAdminClient();
  const { error } = await admin.from("vb_cdi_rates").upsert(
    rows.map((row) => ({ rate_date: row.rate_date, rate: row.rate, fetched_at: new Date().toISOString() })),
    { onConflict: "rate_date" },
  );
  if (error) throw new Error(error.message);

  const newest = rows.reduce((max, row) => (row.rate_date > max ? row.rate_date : max), rows[0].rate_date);
  return { inserted: rows.length, lastDate: newest > (stored ?? "") ? newest : stored };
}
```

- [ ] **Step 7: Validar e commitar**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: sem erros; os 5 testes novos passam junto com os existentes.

```bash
git add src/lib/vb/cdi/bcb.ts src/lib/vb/cdi/bcb.test.ts src/lib/vb/cdi/queries.ts src/lib/vb/cdi/sync.ts
git commit -m "feat(vb): busca e cache do CDI diário do Banco Central

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

### Task 3: Server actions da prévia e da gravação, e o cron

**Files:**
- Create: `src/lib/vb/actions/cdi.ts`
- Create: `src/app/api/cron/vb-cdi/route.ts`
- Modify: `vercel.json` (lista `crons`)

**Interfaces:**
- Consumes: `planAccrual`, `AccrualSegment`, `VB_CDI_DESCRIPTION` (Task 1); `loadCdiRates`, `lastCdiDate`, `accrualStartFor`, `syncCdiRates` (Task 2); `requireVbGestor` de `@/lib/vb/auth`; `listCreditors`, `listEntries` de `@/lib/vb/queries`; `createAdminClient`; `isCronAuthorized` de `@/lib/auth/cron`; `VbActionResult` de `@/lib/vb/types`.
- Produces:
  - `interface CdiAccrualItem { creditor_id: string; creditor_name: string; period_start: string; period_end: string; days: number; balance: number; rate: number; amount: number }`
  - `previewCdiAccrual(): Promise<VbActionResult<{ items: CdiAccrualItem[]; total: number; lastRateDate: string | null }>>`
  - `postCdiAccrual(): Promise<VbActionResult<{ created: number; total: number }>>`
  - `accrueForCreditors(creditorIds: readonly string[], upTo: string): Promise<{ created: number; retroativo: boolean }>`

- [ ] **Step 1: Escrever as actions**

```ts
// src/lib/vb/actions/cdi.ts
"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireVbGestor } from "@/lib/vb/auth";
import { planAccrual, type AccrualSegment } from "@/lib/vb/cdi/accrual";
import { VB_CDI_DESCRIPTION } from "@/lib/vb/cdi/config";
import { accrualStartFor, lastCdiDate, loadCdiRates } from "@/lib/vb/cdi/queries";
import { syncCdiRates } from "@/lib/vb/cdi/sync";
import { listCreditors, listEntries } from "@/lib/vb/queries";
import { fromCents, sumCents } from "@/lib/vb/money";
import type { VbActionResult, VbEntryInsert } from "@/lib/vb/types";

export interface CdiAccrualItem {
  creditor_id: string;
  creditor_name: string;
  period_start: string;
  period_end: string;
  days: number;
  balance: number;
  /** Fração acumulada do período (0.0025 = 0,25%). */
  rate: number;
  amount: number;
}

interface Plan {
  items: CdiAccrualItem[];
  total: number;
  lastRateDate: string | null;
}

/**
 * Calcula, sem gravar, o rendimento que falta para cada credor ativo. É a
 * mesma função que a gravação usa — a prévia nunca vira entrada de dados.
 */
async function buildPlan(): Promise<Plan> {
  const until = await lastCdiDate();
  if (!until) return { items: [], total: 0, lastRateDate: null };

  const admin = createAdminClient();
  const creditors = (await listCreditors(admin)).filter((c) => c.active);
  const rates = await loadCdiRates("1900-01-01");
  const items: CdiAccrualItem[] = [];

  for (const creditor of creditors) {
    const from = await accrualStartFor(creditor.id);
    if (until <= from) continue;
    const entries = await listEntries(admin, { status: "aprovado", creditorId: creditor.id });
    for (const segment of planAccrual({ entries, rates, from, until })) {
      items.push({
        creditor_id: creditor.id,
        creditor_name: creditor.name,
        period_start: segment.period_start,
        period_end: segment.period_end,
        days: segment.days,
        balance: segment.balance,
        rate: segment.rate,
        amount: segment.amount,
      });
    }
  }
  return { items, total: fromCents(sumCents(items.map((i) => i.amount))), lastRateDate: until };
}

/** Linha de vb_entries para um segmento calculado. */
function toEntryRow(item: CdiAccrualItem, groupId: string, userId: string, index: number): VbEntryInsert {
  return {
    creditor_id: item.creditor_id,
    entry_date: item.period_end,
    kind: "rendimento",
    amount: item.amount,
    description: VB_CDI_DESCRIPTION,
    period_start: item.period_start,
    period_end: item.period_end,
    days: item.days,
    rate: item.rate,
    rate_basis: "cdi",
    status: "aprovado",
    import_batch_id: null,
    source_row: null,
    sheet_balance: null,
    sort_order: index,
    flags: [],
    group_id: groupId,
    created_by: userId,
  };
}

export async function previewCdiAccrual(): Promise<VbActionResult<Plan>> {
  await requireVbGestor();
  try {
    await syncCdiRates();
  } catch (error) {
    // Sem internet o cálculo segue com o que já está gravado.
    console.error("[vb-cdi] sync failed, using stored rates", error);
  }
  try {
    return { ok: true, ...(await buildPlan()) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao calcular o rendimento." };
  }
}

export async function postCdiAccrual(): Promise<VbActionResult<{ created: number; total: number }>> {
  const user = await requireVbGestor();
  try {
    await syncCdiRates();
  } catch (error) {
    console.error("[vb-cdi] sync failed, using stored rates", error);
  }
  // Recalcula no servidor: a prévia do cliente nunca é entrada de dados.
  let plan: Plan;
  try {
    plan = await buildPlan();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao calcular o rendimento." };
  }
  if (plan.items.length === 0) return { ok: true, created: 0, total: 0 };

  const groupId = randomUUID();
  const rows = plan.items.map((item, index) => toEntryRow(item, groupId, user.id, index));
  const admin = createAdminClient();
  const { data, error } = await admin.from("vb_entries").insert(rows).select("id");
  if (error || !data) return { error: error?.message ?? "Falha ao gravar os rendimentos." };

  revalidatePath("/vb");
  for (const id of Array.from(new Set(plan.items.map((i) => i.creditor_id)))) {
    revalidatePath(`/vb/credores/${id}`);
  }
  return { ok: true, created: data.length, total: plan.total };
}

/**
 * Fecha o rendimento de alguns credores até `upTo`, para o lançamento manual.
 * Conveniência, não requisito: o motor reconstrói os segmentos, então lançar
 * sem fechar antes não corrompe o cálculo seguinte. Por isso nunca lança erro.
 */
export async function accrueForCreditors(
  creditorIds: readonly string[],
  upTo: string,
): Promise<{ created: number; retroativo: boolean }> {
  // Toda função exportada de um arquivo "use server" é chamável pela rede por
  // id, mesmo sem nenhum import apontando para ela. A checagem é aqui, e o
  // created_by sai da sessão verificada — nunca de parâmetro.
  const user = await requireVbGestor();
  try {
    const until = await lastCdiDate();
    if (!until) return { created: 0, retroativo: false };
    const limit = upTo < until ? upTo : until;

    const admin = createAdminClient();
    const rates = await loadCdiRates("1900-01-01");
    const rows: VbEntryInsert[] = [];
    const groupId = randomUUID();
    let retroativo = false;
    let index = 0;

    for (const creditorId of Array.from(new Set(creditorIds))) {
      const from = await accrualStartFor(creditorId);
      if (upTo < from) {
        retroativo = true;
        continue;
      }
      if (limit <= from) continue;
      const entries = await listEntries(admin, { status: "aprovado", creditorId });
      for (const segment of planAccrual({ entries, rates, from, until: limit })) {
        rows.push(
          toEntryRow(
            {
              creditor_id: creditorId,
              creditor_name: "",
              period_start: segment.period_start,
              period_end: segment.period_end,
              days: segment.days,
              balance: segment.balance,
              rate: segment.rate,
              amount: segment.amount,
            },
            groupId,
            user.id,
            index++,
          ),
        );
      }
    }
    if (rows.length === 0) return { created: 0, retroativo };
    const { data, error } = await admin.from("vb_entries").insert(rows).select("id");
    if (error) {
      console.error("[vb-cdi] accrual before entry failed", error.message);
      return { created: 0, retroativo };
    }
    return { created: data?.length ?? 0, retroativo };
  } catch (error) {
    console.error("[vb-cdi] accrual before entry failed", error);
    return { created: 0, retroativo: false };
  }
}
```

- [ ] **Step 2: Escrever o cron**

```ts
// src/app/api/cron/vb-cdi/route.ts
import { NextResponse } from "next/server";

import { isCronAuthorized } from "@/lib/auth/cron";
import { syncCdiRates } from "@/lib/vb/cdi/sync";

// ============================================================================
// GET /api/cron/vb-cdi — CDI DIÁRIO DO VB
//
// Roda às 08:00 de Brasília (11:00 UTC), de segunda a sexta, e só BAIXA as
// taxas do Banco Central que faltam. NÃO lança rendimento: se lançasse, o
// extrato ganharia uma linha por dia. O lançamento é sempre por decisão — o
// botão "Calcular rendimento" na Visão geral, ou o fechamento automático
// quando um lançamento manual é gravado.
// ============================================================================

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await syncCdiRates();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CDI sync failed.";
    console.error("[vb-cdi] cron failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Registrar o cron em `vercel.json`**

Acrescente ao array `crons`, depois da entrada de `/api/cron/ctrl-approval-reminders`:

```json
    { "path": "/api/cron/vb-cdi", "schedule": "0 11 * * 1-5" }
```

- [ ] **Step 4: Validar e commitar**

Run: `npx tsc --noEmit && npm run lint && npm test`

```bash
git add src/lib/vb/actions/cdi.ts src/app/api/cron/vb-cdi/route.ts vercel.json
git commit -m "feat(vb): prévia e gravação do rendimento por CDI, e cron diário das taxas

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

### Task 4: Botão e prévia na tela, fechamento no lançamento manual, script e documentação

**Files:**
- Create: `src/components/vb/cdi-accrual-dialog.tsx`
- Modify: `src/app/(vb)/vb/page.tsx` (cabeçalho, ao lado de "Novo lançamento")
- Modify: `src/lib/vb/actions/entries.ts` (fecha o rendimento antes de gravar)
- Create: `scripts/vb-cdi-check.ts`
- Modify: `CLAUDE.md` (seção "### Módulo VB")

**Interfaces:**
- Consumes: `previewCdiAccrual`, `postCdiAccrual`, `accrueForCreditors`, `CdiAccrualItem` (Task 3); `planAccrual` (Task 1); `formatDayBR` de `@/lib/ctrl/datetime`; `formatBRL` de `@/lib/orcamento/format`; `useToast` de `@/components/ui/toaster`.
- Produces: `VbCdiAccrualDialog({ lastRateDate })` — botão "Calcular rendimento" com o diálogo de prévia.

- [ ] **Step 1: Escrever o diálogo**

```tsx
// src/components/vb/cdi-accrual-dialog.tsx
"use client";

// "Calcular rendimento": mostra o que SERÁ lançado antes de gravar. A gravação
// recalcula tudo no servidor — o que está aqui é só para conferência, nunca
// entra como dado.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, TrendingUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toaster";
import { formatDayBR } from "@/lib/ctrl/datetime";
import { formatBRL } from "@/lib/orcamento/format";
import { postCdiAccrual, previewCdiAccrual, type CdiAccrualItem } from "@/lib/vb/actions/cdi";

function formatRate(rate: number): string {
  return `${(rate * 100).toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}%`;
}

export function VbCdiAccrualDialog() {
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();
  const [items, setItems] = useState<CdiAccrualItem[]>([]);
  const [total, setTotal] = useState(0);
  const [lastRateDate, setLastRateDate] = useState<string | null>(null);

  function openDialog() {
    setOpen(true);
    startLoading(async () => {
      try {
        const result = await previewCdiAccrual();
        if ("error" in result) {
          showToast({ title: "Não foi possível calcular", description: result.error, variant: "destructive" });
          setOpen(false);
          return;
        }
        setItems(result.items);
        setTotal(result.total);
        setLastRateDate(result.lastRateDate);
      } catch (error) {
        showToast({
          title: "Não foi possível calcular",
          description: error instanceof Error ? error.message : "Erro inesperado.",
          variant: "destructive",
        });
        setOpen(false);
      }
    });
  }

  function post() {
    startSaving(async () => {
      try {
        const result = await postCdiAccrual();
        if ("error" in result) {
          showToast({ title: "Não gravado", description: result.error, variant: "destructive" });
          return;
        }
        showToast({
          title: result.created === 0 ? "Nada a lançar" : `${result.created} rendimento(s): ${formatBRL(result.total)}`,
          variant: "success",
        });
        setOpen(false);
        router.refresh();
      } catch (error) {
        showToast({
          title: "Não gravado",
          description: error instanceof Error ? error.message : "Erro inesperado.",
          variant: "destructive",
        });
      }
    });
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={openDialog}>
        <TrendingUp className="mr-2 h-4 w-4" /> Calcular rendimento
      </Button>
      <Dialog open={open} onOpenChange={(v) => !saving && setOpen(v)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Rendimento por CDI</DialogTitle>
            <DialogDescription>
              {lastRateDate
                ? `Calculado com o CDI do Banco Central até ${formatDayBR(lastRateDate)}. Confira antes de lançar.`
                : "Calculado com o CDI do Banco Central."}
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <p className="py-8 text-center text-sm text-ink-muted">
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Calculando…
            </p>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-muted">
              Nenhum rendimento a lançar{lastRateDate ? ` até ${formatDayBR(lastRateDate)}` : ""}.
            </p>
          ) : (
            <div className="max-h-[50vh] overflow-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-ink-muted">
                    <th className="py-1.5 pr-3 font-medium">Credor</th>
                    <th className="py-1.5 pr-3 font-medium">Período</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Dias</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Saldo base</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Taxa</th>
                    <th className="py-1.5 text-right font-medium">Rendimento</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={`${item.creditor_id}-${item.period_start}-${item.period_end}`} className="border-b border-border/60">
                      <td className="py-1.5 pr-3 font-medium text-ink-primary">{item.creditor_name}</td>
                      <td className="whitespace-nowrap py-1.5 pr-3 text-ink-secondary">
                        {formatDayBR(item.period_start)} a {formatDayBR(item.period_end)}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-ink-muted">{item.days}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{formatBRL(item.balance)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-ink-muted">{formatRate(item.rate)}</td>
                      <td className="py-1.5 text-right font-medium tabular-nums text-sky-700">{formatBRL(item.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <DialogFooter className="items-center">
            {items.length > 0 && (
              <span className="mr-auto text-[13px] tabular-nums text-ink-primary">
                Total: <span className="font-medium text-sky-700">{formatBRL(total)}</span>
              </span>
            )}
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="button" onClick={post} disabled={saving || loading || items.length === 0}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Lançar rendimento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 2: Colocar o botão na Visão geral**

Em `src/app/(vb)/vb/page.tsx`, acrescente o import `import { VbCdiAccrualDialog } from "@/components/vb/cdi-accrual-dialog";` e, dentro da `<div className="flex items-center gap-2">` do cabeçalho, **antes** do `<VbNewEntryDialog …>`:

```tsx
          {isGestor && creditors.length > 0 && <VbCdiAccrualDialog />}
```

- [ ] **Step 3: Fechar o rendimento antes do lançamento manual**

Em `src/lib/vb/actions/entries.ts`, dentro de `createVbEntries`, **depois** da checagem de que todos os credores existem e **antes** do `insert` em `vb_entries`:

```ts
  // Fecha o rendimento até a véspera do lançamento. É conveniência, não
  // requisito: o motor reconstrói os segmentos a partir da linha do tempo, de
  // modo que gravar sem fechar antes não corrompe o cálculo seguinte. Por isso
  // a falha aqui nunca derruba o lançamento.
  const accrual = await accrueForCreditors(creditorIds, parsed.data.entry_date);
```

E, no retorno de sucesso, devolva o que aconteceu para a tela avisar:

```ts
  return { ok: true, ids: data.map((row) => row.id as string), group_id, accrued: accrual.created, retroativo: accrual.retroativo };
```

Ajuste o tipo de retorno da função para
`Promise<VbActionResult<{ ids: string[]; group_id: string; accrued: number; retroativo: boolean }>>`
e acrescente o import `import { accrueForCreditors } from "@/lib/vb/actions/cdi";`.

Em `src/components/vb/new-entry-dialog.tsx`, no `submit`, depois do toast de sucesso, acrescente o aviso quando houver algo a dizer (só no modo normal, em que `result` tem os campos):

```tsx
      if (!omie && "accrued" in result && result.accrued > 0) {
        showToast({ title: `Rendimento fechado antes: ${result.accrued} lançamento(s)`, variant: "default" });
      }
      if (!omie && "retroativo" in result && result.retroativo) {
        showToast({
          title: "Data retroativa",
          description: "O rendimento já lançado não foi recalculado.",
          variant: "default",
        });
      }
```

- [ ] **Step 4: Escrever o script de conferência**

```ts
// scripts/vb-cdi-check.ts
// Confere o motor de rendimento contra um período JÁ FECHADO do histórico
// importado: busca o CDI real do período no Banco Central, aplica o motor
// sobre o saldo daquele momento e compara com o valor que a planilha lançou.
// Não toca no banco de dados de nenhuma forma além de ler.
//
//   npx tsx scripts/vb-cdi-check.ts

import { createClient } from "@supabase/supabase-js";

import { fetchCdiRange } from "@/lib/vb/cdi/bcb";
import { planAccrual } from "@/lib/vb/cdi/accrual";
import { currentBalance } from "@/lib/vb/ledger";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  const db = createClient(url, key);

  const { data: rendimentos, error } = await db
    .from("vb_entries")
    .select("creditor_id, period_start, period_end, rate, amount, vb_creditors(name)")
    .eq("status", "aprovado")
    .eq("kind", "rendimento")
    .eq("rate_basis", "periodo")
    .not("period_start", "is", null)
    .order("entry_date", { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);

  for (const row of (rendimentos ?? []) as Array<Record<string, unknown>>) {
    const periodStart = row.period_start as string;
    const periodEnd = row.period_end as string;
    const creditorId = row.creditor_id as string;
    const nome = ((row.vb_creditors as { name?: string } | null)?.name) ?? creditorId;

    const { data: entries } = await db
      .from("vb_entries")
      .select("id, entry_date, sort_order, created_at, kind, amount")
      .eq("creditor_id", creditorId)
      .eq("status", "aprovado")
      .lte("entry_date", periodEnd);
    const rows = (entries ?? []).map((e) => ({ ...e, amount: Number((e as { amount: number | string }).amount) }));

    const rates = new Map((await fetchCdiRange(periodStart, periodEnd)).map((r) => [r.rate_date, r.rate]));
    const segments = planAccrual({ entries: rows, rates, from: periodStart, until: periodEnd });
    const calculado = segments.reduce((sum, s) => sum + s.amount, 0);
    const lancado = Number(row.amount);
    const saldo = currentBalance(rows.filter((e) => e.entry_date <= periodStart));

    console.log(
      `${nome.padEnd(10)} ${periodStart} a ${periodEnd}` +
        ` | saldo ${saldo.toFixed(2)}` +
        ` | planilha ${lancado.toFixed(2)} (taxa ${(Number(row.rate) * 100).toFixed(4)}%)` +
        ` | CDI real ${calculado.toFixed(2)}` +
        ` | diferença ${(calculado - lancado).toFixed(2)}`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
```

- [ ] **Step 5: Documentar em `CLAUDE.md`**

Na seção "### Módulo VB (`/vb`, Viva Bank)", logo depois do parágrafo "Triagem da Omie", acrescente:

```markdown
- **Rendimento por CDI (`src/lib/vb/cdi/`)**: o saldo parado de cada credor ativo rende 100% do CDI diário do Banco Central (série 12 do SGS), baixado pelo cron `/api/cron/vb-cdi` e guardado em `vb_cdi_rates` — guardar é o que torna o cálculo reproduzível e auditável. **Sem retroativo**: `VB_CDI_START_DATE` é o marco zero e nada anterior rende. O motor (`accrual.ts`, puro e testado) parte do `period_end` do último rendimento com `rate_basis='cdi'` do credor, vai até a maior data com taxa gravada, corta o tempo em segmentos de saldo parado (cada lançamento fecha um) e aplica o produto de `(1 + taxa/100)` dos dias úteis do intervalo **meio aberto** `(start, end]` — o dia em que um período fecha é o mesmo em que o próximo abre e a taxa dele conta uma vez. Só saldo positivo rende. O rendimento vira lançamento em `period_end`, então o segmento seguinte rende sobre ele sem tratamento especial. **O motor é independente de ordem** (reconstrói os segmentos a partir da linha do tempo), e é isso que permite que o fechamento automático dentro de `createVbEntries` seja conveniência e nunca derrube o lançamento. O botão "Calcular rendimento" mostra a prévia e só grava depois da confirmação, sempre recalculando no servidor. O cron **não lança rendimento**, só baixa taxas: uma linha por dia no extrato seria ilegível. `npx tsx scripts/vb-cdi-check.ts` compara o motor com um período já fechado do histórico.
```

- [ ] **Step 6: Validar e commitar**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: sem erros; a suíte segue verde.

```bash
git add src/components/vb/cdi-accrual-dialog.tsx 'src/app/(vb)/vb/page.tsx' src/lib/vb/actions/entries.ts src/components/vb/new-entry-dialog.tsx scripts/vb-cdi-check.ts CLAUDE.md
git commit -m "feat(vb): botão de rendimento com prévia, fechamento no lançamento manual e docs

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Verificação final (controlador)

1. `npm run lint && npm test && npx tsc --noEmit` na branch inteira.
2. Migration aplicada em produção (MCP) **antes** de o dono abrir a tela — a Task 1 só cria o arquivo.
3. `npx tsx scripts/vb-cdi-check.ts` para ver o motor contra o histórico.
4. Roteiro manual: abrir a prévia, conferir um credor à mão (saldo × taxa), lançar, ver no extrato do credor, clicar de novo e confirmar que não duplica.
