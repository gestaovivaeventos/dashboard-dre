# Home Cockpit — Plano 2 (Widgets Financeiros)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) ou superpowers:executing-plans. Steps usam checkbox (`- [ ]`).
>
> **Sem framework de testes** (ver CLAUDE.md). Validação = `npm run lint` + `npm run build` + checagem manual. Não escreva testes unitários.

**Goal:** Adicionar à `/home` os widgets financeiros — Resultado do mês (KPIs do grupo: receita líquida, despesas, resultado + variação vs mês anterior), Caixa gerado no mês, e Mini-DRE da unidade do franqueado — reusando os motores DRE/Fluxo de Caixa existentes; e passar o franqueado a também cair em `/home`.

**Architecture:** Um módulo `src/lib/home/financeiro-widgets.ts` reusa as funções centrais (`loadScopedDreAccounts`, `aggregateDreRows`, `findResultadoExercicio` de `dre.ts`; `buildCashFlowRows` + RPC `cash_flow_aggregate` de `cash-flow.ts`) para calcular apenas os poucos números do mês corrente (e mês anterior, p/ variação). A `home/page.tsx` (server) carrega esses dados quando aplicável e passa para `HomeView`, que renderiza uma seção "Visão financeira" antes do bloco de indicadores/notícias. Cada cálculo é isolado em try/catch — falha de um widget não derruba a home.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (RPCs `dashboard_dre_aggregate`, `cash_flow_aggregate`), Tailwind/shadcn, lucide-react.

**Escopo (Plano 2):** widgets KPIs do grupo, Caixa, Mini-DRE franqueado; franqueado→/home. **Já feito no Plano 1:** indicadores/notícias/alertas já estão no rodapé gated a `canFinanceiro` — este plano só adiciona a seção financeira ACIMA deles.

---

## Referências de código (verificadas)

- `getCurrentSessionContext()` → `{ supabase, user, profile }`. `profile.role` (`admin|gestor_hero|gestor_unidade`), `profile.profile` (`UserProfileType`, ex.: `franqueado`), `profile.company_ids: string[]`, `profile.id`.
- DRE (`src/lib/dashboard/dre.ts`):
  - `loadScopedDreAccounts(supabase, companyIds): Promise<ScopedDreAccounts>` — carrega e escopa o plano (global p/ multi-empresa).
  - `aggregateDreRows({ supabase, scope, companyIds, dateFrom, dateTo }): Promise<DashboardRow[]>` — `DashboardRow` tem `{ code, name, value, ... }`.
  - `findResultadoExercicio(rows): number` — code "11".
  - **Receita líquida = code "4"** (em `buildDashboardRows`, `netRevenueAccount = code "4"`).
  - `resolveAllowedCompanyIds(supabase, profile, allCompanyIds): Promise<string[]>` — admin = todas; senão `user_company_access`.
- Caixa (`src/lib/dashboard/cash-flow.ts`):
  - `buildCashFlowRows(accounts, amountsByAccountId, { dreResultadoExercicio, saldoInicial }): { rows }`. Com `saldoInicial: 0`, a linha **"Caixa Final" (code "90.3")** = caixa gerado no período (entradas − saídas).
  - `previousMonth(year, month): { year, month }`.
  - `CashFlowAccountBase` precisa dos campos: `id, code, name, parent_id, level, type, is_summary, formula, source, is_highlight_block, sort_order, active`.
  - RPC `cash_flow_aggregate(p_company_ids, p_date_from, p_date_to)` → `[{ cash_flow_account_id, amount }]`.
- Padrão dos widgets (Plano 1): componentes em `src/components/app/home/`, wrapper `WidgetCard`/`WidgetEmpty` (`src/components/app/home/widget-card.tsx`), client components, `fmtBRL` (Intl decimal pt-BR).
- `home/page.tsx` atual (pós-Plano 1) já passa `userName/caps/ctrlData/canFinanceiro` para `HomeView`. `canFinanceiro = Boolean(modules?.dre)`.
- `home-view.tsx` atual já tem o rodapé `{canFinanceiro && (<> Indicadores / Alertas / Notícias </>)}`.

---

## File Structure

**Criar:**
- `src/lib/home/financeiro-widgets.ts` — tipos + caps + 3 loaders (KPIs, Caixa, Mini-DRE).
- `src/components/app/home/widget-kpis.tsx` — Resultado do mês (receita/despesa/resultado + variação).
- `src/components/app/home/widget-caixa.tsx` — Caixa gerado no mês.
- `src/components/app/home/widget-mini-dre.tsx` — Mini-DRE da unidade (franqueado).

**Modificar:**
- `src/lib/auth/access.ts` — `defaultLandingFor`: franqueado passa a ir para `/home`.
- `src/app/(app)/home/page.tsx` — carrega dados financeiros e passa para a view.
- `src/components/app/home-view.tsx` — nova seção "Visão financeira" (KPIs+Caixa, ou Mini-DRE) antes dos indicadores.

---

## Task 1: Módulo de dados financeiros

**Files:**
- Create: `src/lib/home/financeiro-widgets.ts`

- [ ] **Step 1: Criar o módulo**

Crie `src/lib/home/financeiro-widgets.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  aggregateDreRows,
  findResultadoExercicio,
  loadScopedDreAccounts,
  resolveAllowedCompanyIds,
} from "@/lib/dashboard/dre";
import { buildCashFlowRows, previousMonth } from "@/lib/dashboard/cash-flow";
import type { CashFlowAccountBase } from "@/lib/dashboard/cash-flow";

export const fmtFin = new Intl.NumberFormat("pt-BR", {
  style: "decimal",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Perfil mínimo que os loaders precisam (subset de UnifiedProfile).
export interface FinProfile {
  id: string;
  role: string;
  profile: string;
  company_ids: string[];
}

export interface HomeFinanceiroCaps {
  showGrupo: boolean; // KPIs do grupo + Caixa (gestão/admin com financeiro)
  showMiniDre: boolean; // Mini-DRE da unidade (franqueado com financeiro)
}

export function deriveFinanceiroCaps(
  profile: FinProfile | null,
  canFinanceiro: boolean,
): HomeFinanceiroCaps {
  if (!profile || !canFinanceiro) return { showGrupo: false, showMiniDre: false };
  const isFranqueado = profile.profile === "franqueado";
  return {
    showGrupo: !isFranqueado,
    showMiniDre: isFranqueado && profile.company_ids.length > 0,
  };
}

export interface HomeKpis {
  receita: number;
  despesa: number;
  resultado: number;
  resultadoVariacaoPct: number | null; // vs mês anterior; null se mês anterior = 0
  mesLabel: string;
}
export interface HomeCaixa {
  caixaGeradoMes: number;
  mesLabel: string;
}
export interface HomeMiniDre {
  resultado: number;
  receita: number;
  mesLabel: string;
}

const MES_LABELS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function monthBounds(year: number, month: number): { from: string; to: string } {
  return {
    from: new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10),
    to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
  };
}

function receitaLiquida(rows: { code: string; value: number }[]): number {
  return rows.find((r) => r.code === "4")?.value ?? 0;
}

async function allowedCompanies(
  supabase: SupabaseClient,
  profile: FinProfile,
): Promise<string[]> {
  const { data } = await supabase.from("companies").select("id").eq("active", true);
  const ids = (data ?? []).map((c) => c.id as string);
  return resolveAllowedCompanyIds(supabase, profile, ids);
}

// KPIs do grupo (ou das empresas que o usuário enxerga): receita líquida,
// despesas (= receita − resultado), resultado do exercício, do mês corrente,
// com variação do resultado vs mês anterior.
export async function loadKpisGrupo(
  supabase: SupabaseClient,
  profile: FinProfile,
): Promise<HomeKpis | null> {
  try {
    const companyIds = await allowedCompanies(supabase, profile);
    if (companyIds.length === 0) return null;

    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const cur = monthBounds(year, month);
    const prev = previousMonth(year, month);
    const prevB = monthBounds(prev.year, prev.month);

    const scope = await loadScopedDreAccounts(supabase, companyIds);

    const [curRows, prevRows] = await Promise.all([
      aggregateDreRows({ supabase, scope, companyIds, dateFrom: cur.from, dateTo: cur.to }),
      aggregateDreRows({ supabase, scope, companyIds, dateFrom: prevB.from, dateTo: prevB.to }),
    ]);

    const receita = receitaLiquida(curRows);
    const resultado = findResultadoExercicio(curRows);
    const resultadoPrev = findResultadoExercicio(prevRows);
    const despesa = receita - resultado;
    const resultadoVariacaoPct =
      resultadoPrev !== 0
        ? ((resultado - resultadoPrev) / Math.abs(resultadoPrev)) * 100
        : null;

    return {
      receita,
      despesa,
      resultado,
      resultadoVariacaoPct,
      mesLabel: `${MES_LABELS[month - 1]}/${year}`,
    };
  } catch {
    return null;
  }
}

// Caixa gerado no mês (entradas − saídas) = "Caixa Final" (code 90.3) calculado
// com saldo inicial 0. Reusa o motor de Fluxo de Caixa para respeitar os sinais
// por tipo de conta e o Resultado do Exercício do mês.
export async function loadCaixaMes(
  supabase: SupabaseClient,
  profile: FinProfile,
): Promise<HomeCaixa | null> {
  try {
    const companyIds = await allowedCompanies(supabase, profile);
    if (companyIds.length === 0) return null;

    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const { from, to } = monthBounds(year, month);

    const { data: cfData } = await supabase
      .from("cash_flow_accounts")
      .select(
        "id,code,name,parent_id,level,type,is_summary,formula,source,is_highlight_block,sort_order,active",
      )
      .eq("active", true)
      .is("company_id", null)
      .order("sort_order");

    const accounts: CashFlowAccountBase[] = (cfData ?? []).map((a) => ({
      id: a.id as string,
      code: a.code as string,
      name: a.name as string,
      parent_id: (a.parent_id as string | null) ?? null,
      level: a.level as number,
      type: a.type as CashFlowAccountBase["type"],
      is_summary: Boolean(a.is_summary),
      formula: (a.formula as string | null) ?? null,
      source: (a.source as CashFlowAccountBase["source"]) ?? null,
      is_highlight_block: Boolean(a.is_highlight_block),
      sort_order: a.sort_order as number,
      active: Boolean(a.active),
    }));
    if (accounts.length === 0) return null;

    const scope = await loadScopedDreAccounts(supabase, companyIds);
    const dreRows = await aggregateDreRows({
      supabase,
      scope,
      companyIds,
      dateFrom: from,
      dateTo: to,
    });
    const dreResultado = findResultadoExercicio(dreRows);

    const { data: cfAgg } = await supabase.rpc("cash_flow_aggregate", {
      p_company_ids: companyIds,
      p_date_from: from,
      p_date_to: to,
    });
    const amounts = new Map<string, number>();
    (
      (cfAgg as Array<{ cash_flow_account_id: string; amount: number | string | null }> | null) ??
      []
    ).forEach((i) => amounts.set(i.cash_flow_account_id, Number(i.amount ?? 0)));

    const { rows } = buildCashFlowRows(accounts, amounts, {
      dreResultadoExercicio: dreResultado,
      saldoInicial: 0,
    });
    const caixaGeradoMes = rows.find((r) => r.code === "90.3")?.value ?? 0;

    return { caixaGeradoMes, mesLabel: `${MES_LABELS[month - 1]}/${year}` };
  } catch {
    return null;
  }
}

// Mini-DRE da unidade do franqueado: resultado e receita do mês corrente,
// escopado às empresas do franqueado (profile.company_ids).
export async function loadMiniDreFranqueado(
  supabase: SupabaseClient,
  profile: FinProfile,
): Promise<HomeMiniDre | null> {
  try {
    const companyIds = profile.company_ids;
    if (companyIds.length === 0) return null;

    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const { from, to } = monthBounds(year, month);

    const scope = await loadScopedDreAccounts(supabase, companyIds);
    const rows = await aggregateDreRows({
      supabase,
      scope,
      companyIds,
      dateFrom: from,
      dateTo: to,
    });

    return {
      resultado: findResultadoExercicio(rows),
      receita: receitaLiquida(rows),
      mesLabel: `${MES_LABELS[month - 1]}/${year}`,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Validar lint**

Run: `npm run lint`
Expected: `✔ No ESLint warnings or errors`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/home/financeiro-widgets.ts
git commit -m "feat(home): módulo de dados dos widgets financeiros"
```

---

## Task 2: Franqueado cai em /home

**Files:**
- Modify: `src/lib/auth/access.ts` (`defaultLandingFor`)

- [ ] **Step 1: Atualizar `defaultLandingFor`**

Em `src/lib/auth/access.ts`, substitua a função `defaultLandingFor` por (remove o desvio do franqueado para `/dashboard` — agora a `/home` tem o widget Mini-DRE dele):

```ts
export function defaultLandingFor(
  profile: UserProfileType,
  canFinanceiro: boolean,
  canCompras: boolean,
): string {
  // Ilha de contratos — não passa pela home.
  if (profile === "validador_contrato") return "/contratos";
  // Todos os demais perfis com algum módulo → cockpit /home.
  if (canFinanceiro || canCompras || profile === "admin") return "/home";
  return "/pendente";
}
```

- [ ] **Step 2: Validar lint + build**

Run: `npm run lint && npm run build`
Expected: lint limpo; build compila (erros de geração estática em `/login` e `/` por falta de credencial Supabase local são pré-existentes — ignore).

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/access.ts
git commit -m "feat(home): franqueado passa a cair em /home"
```

---

## Task 3: Widget KPIs (Resultado do mês)

**Files:**
- Create: `src/components/app/home/widget-kpis.tsx`

- [ ] **Step 1: Criar o widget**

Crie `src/components/app/home/widget-kpis.tsx`:

```tsx
"use client";

import { TrendingUp, TrendingDown } from "lucide-react";

import { WidgetCard } from "@/components/app/home/widget-card";
import { fmtFin, type HomeKpis } from "@/lib/home/financeiro-widgets";

export function WidgetKpis({ data }: { data: HomeKpis }) {
  const resultadoPositivo = data.resultado >= 0;
  return (
    <WidgetCard title={`Resultado — ${data.mesLabel}`} icon={TrendingUp} href="/dashboard">
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-xs text-muted-foreground">Receita líquida</p>
          <p className="mt-0.5 text-lg font-bold">{fmtFin.format(data.receita)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Despesas</p>
          <p className="mt-0.5 text-lg font-bold">{fmtFin.format(data.despesa)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Resultado</p>
          <p
            className={`mt-0.5 text-lg font-bold ${
              resultadoPositivo ? "text-green-600" : "text-red-600"
            }`}
          >
            {fmtFin.format(data.resultado)}
          </p>
        </div>
      </div>
      {data.resultadoVariacaoPct !== null && (
        <div className="mt-3 flex items-center justify-center gap-1 text-xs">
          {data.resultadoVariacaoPct >= 0 ? (
            <TrendingUp className="h-3.5 w-3.5 text-green-600" />
          ) : (
            <TrendingDown className="h-3.5 w-3.5 text-red-600" />
          )}
          <span
            className={data.resultadoVariacaoPct >= 0 ? "text-green-600" : "text-red-600"}
          >
            {data.resultadoVariacaoPct >= 0 ? "+" : ""}
            {data.resultadoVariacaoPct.toFixed(1)}% vs mês anterior
          </span>
        </div>
      )}
    </WidgetCard>
  );
}
```

- [ ] **Step 2: Validar lint**

Run: `npm run lint`
Expected: limpo.

- [ ] **Step 3: Commit**

```bash
git add src/components/app/home/widget-kpis.tsx
git commit -m "feat(home): widget KPIs (resultado do mês)"
```

---

## Task 4: Widget Caixa

**Files:**
- Create: `src/components/app/home/widget-caixa.tsx`

- [ ] **Step 1: Criar o widget**

Crie `src/components/app/home/widget-caixa.tsx`:

```tsx
"use client";

import { Banknote } from "lucide-react";

import { WidgetCard } from "@/components/app/home/widget-card";
import { fmtFin, type HomeCaixa } from "@/lib/home/financeiro-widgets";

export function WidgetCaixa({ data }: { data: HomeCaixa }) {
  const positivo = data.caixaGeradoMes >= 0;
  return (
    <WidgetCard title={`Caixa — ${data.mesLabel}`} icon={Banknote} href="/fluxo-de-caixa">
      <div className="text-center">
        <p className="text-xs text-muted-foreground">Caixa gerado no mês (entradas − saídas)</p>
        <p
          className={`mt-1 text-2xl font-bold ${
            positivo ? "text-green-600" : "text-red-600"
          }`}
        >
          {fmtFin.format(data.caixaGeradoMes)}
        </p>
      </div>
    </WidgetCard>
  );
}
```

- [ ] **Step 2: Validar lint**

Run: `npm run lint`
Expected: limpo.

- [ ] **Step 3: Commit**

```bash
git add src/components/app/home/widget-caixa.tsx
git commit -m "feat(home): widget caixa gerado no mês"
```

---

## Task 5: Widget Mini-DRE (franqueado)

**Files:**
- Create: `src/components/app/home/widget-mini-dre.tsx`

- [ ] **Step 1: Criar o widget**

Crie `src/components/app/home/widget-mini-dre.tsx`:

```tsx
"use client";

import { Building2 } from "lucide-react";

import { WidgetCard } from "@/components/app/home/widget-card";
import { fmtFin, type HomeMiniDre } from "@/lib/home/financeiro-widgets";

export function WidgetMiniDre({ data }: { data: HomeMiniDre }) {
  const positivo = data.resultado >= 0;
  return (
    <WidgetCard title={`Sua unidade — ${data.mesLabel}`} icon={Building2} href="/dashboard">
      <div className="grid grid-cols-2 gap-3 text-center">
        <div>
          <p className="text-xs text-muted-foreground">Receita líquida</p>
          <p className="mt-0.5 text-lg font-bold">{fmtFin.format(data.receita)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Resultado do mês</p>
          <p
            className={`mt-0.5 text-lg font-bold ${
              positivo ? "text-green-600" : "text-red-600"
            }`}
          >
            {fmtFin.format(data.resultado)}
          </p>
        </div>
      </div>
    </WidgetCard>
  );
}
```

- [ ] **Step 2: Validar lint**

Run: `npm run lint`
Expected: limpo.

- [ ] **Step 3: Commit**

```bash
git add src/components/app/home/widget-mini-dre.tsx
git commit -m "feat(home): widget mini-DRE da unidade (franqueado)"
```

---

## Task 6: Integrar na home (page + view)

**Files:**
- Modify: `src/app/(app)/home/page.tsx`
- Modify: `src/components/app/home-view.tsx`

- [ ] **Step 1: Atualizar `home/page.tsx`**

Substitua todo o conteúdo de `src/app/(app)/home/page.tsx` por (adiciona o carregamento dos dados financeiros mantendo todo o comportamento CTRL do Plano 1):

```tsx
import { redirect } from "next/navigation";

import { HomeView } from "@/components/app/home-view";
import { getCurrentSessionContext } from "@/lib/auth/session";
import {
  deriveCtrlCaps,
  loadHomeCtrlData,
  type HomeCtrlData,
} from "@/lib/home/ctrl-widgets";
import {
  deriveFinanceiroCaps,
  loadCaixaMes,
  loadKpisGrupo,
  loadMiniDreFranqueado,
  type FinProfile,
  type HomeCaixa,
  type HomeKpis,
  type HomeMiniDre,
} from "@/lib/home/financeiro-widgets";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { supabase, user, profile, modules } = await getCurrentSessionContext();
  if (!user) redirect("/login");

  const userName = profile?.name || user.email || "Usuário";
  const ctrlRoles = modules?.ctrl?.roles ?? [];
  const sectorIds = profile?.sector_ids ?? [];
  const canFinanceiro = Boolean(modules?.dre);

  const caps = deriveCtrlCaps(ctrlRoles, sectorIds);

  let ctrlData: HomeCtrlData = {
    approvals: null,
    payments: null,
    myRequests: null,
    budget: null,
  };
  if (profile && (caps.canApprove || caps.canPay || caps.canRequest || caps.canBudget)) {
    ctrlData = await loadHomeCtrlData({
      userId: profile.id,
      roles: ctrlRoles,
      sectorIds,
      caps,
    });
  }

  const finProfile: FinProfile | null = profile
    ? {
        id: profile.id,
        role: profile.role,
        profile: profile.profile,
        company_ids: profile.company_ids ?? [],
      }
    : null;
  const finCaps = deriveFinanceiroCaps(finProfile, canFinanceiro);

  let kpis: HomeKpis | null = null;
  let caixa: HomeCaixa | null = null;
  let miniDre: HomeMiniDre | null = null;
  if (finProfile && finCaps.showGrupo) {
    [kpis, caixa] = await Promise.all([
      loadKpisGrupo(supabase, finProfile),
      loadCaixaMes(supabase, finProfile),
    ]);
  } else if (finProfile && finCaps.showMiniDre) {
    miniDre = await loadMiniDreFranqueado(supabase, finProfile);
  }

  return (
    <HomeView
      userName={userName}
      caps={caps}
      ctrlData={ctrlData}
      canFinanceiro={canFinanceiro}
      kpis={kpis}
      caixa={caixa}
      miniDre={miniDre}
    />
  );
}
```

- [ ] **Step 2: Atualizar `home-view.tsx`**

Em `src/components/app/home-view.tsx`, faça TRÊS mudanças:

(a) Atualize os imports no topo (logo após os imports de widgets CTRL existentes) para incluir os widgets financeiros e seus tipos:

```tsx
import { WidgetKpis } from "@/components/app/home/widget-kpis";
import { WidgetCaixa } from "@/components/app/home/widget-caixa";
import { WidgetMiniDre } from "@/components/app/home/widget-mini-dre";
import type { HomeKpis, HomeCaixa, HomeMiniDre } from "@/lib/home/financeiro-widgets";
```

(b) Estenda a interface `HomeViewProps` e a desestruturação dos parâmetros do componente:

```tsx
interface HomeViewProps {
  userName: string;
  caps: HomeCtrlCaps;
  ctrlData: HomeCtrlData;
  canFinanceiro: boolean;
  kpis: HomeKpis | null;
  caixa: HomeCaixa | null;
  miniDre: HomeMiniDre | null;
}
```

E na assinatura do componente:

```tsx
export function HomeView({
  userName,
  caps,
  ctrlData,
  canFinanceiro,
  kpis,
  caixa,
  miniDre,
}: HomeViewProps) {
```

(c) Adicione a seção "Visão financeira" IMEDIATAMENTE ANTES do bloco `{canFinanceiro && (` que renderiza Indicadores/Alertas/Notícias. Insira este JSX:

```tsx
      {/* Visão financeira (server-computed): KPIs + Caixa, ou Mini-DRE do franqueado */}
      {(kpis || caixa || miniDre) && (
        <section>
          <h2 className="mb-3 text-base font-semibold">Visão financeira</h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {kpis && <WidgetKpis data={kpis} />}
            {caixa && <WidgetCaixa data={caixa} />}
            {miniDre && <WidgetMiniDre data={miniDre} />}
          </div>
        </section>
      )}
```

- [ ] **Step 3: Validar lint + build**

Run: `npm run lint && npm run build`
Expected: lint limpo; build compila. Se acusar import/var não usado, corrija.

- [ ] **Step 4: Commit**

```bash
git add src/app/(app)/home/page.tsx src/components/app/home-view.tsx
git commit -m "feat(home): seção Visão financeira (KPIs, Caixa, Mini-DRE)"
```

---

## Task 7: QA manual e fechamento

**Files:** nenhum.

- [ ] **Step 1: Rodar o app** — `npm run dev`, abrir `http://localhost:3000/home`.

- [ ] **Step 2: Checklist por perfil**
- **Admin/gestor com financeiro:** seção "Visão financeira" mostra KPIs (receita/despesa/resultado do mês + variação) e Caixa gerado no mês; números batem com `/dashboard` e `/fluxo-de-caixa` no mês corrente.
- **Franqueado:** cai em `/home` ao logar; vê o widget "Sua unidade" (Mini-DRE) com receita/resultado do mês da unidade; NÃO vê KPIs do grupo nem Caixa consolidado.
- **Usuário sem financeiro:** não vê a seção "Visão financeira".
- **Indicadores/Notícias:** continuam aparecendo abaixo da Visão financeira (só p/ financeiro).

- [ ] **Step 3: Conferir consistência dos números** — comparar resultado do mês do widget KPIs com o "Resultado do Exercício" do `/dashboard` (mês corrente, mesmas empresas) e o caixa gerado com `/fluxo-de-caixa`.

- [ ] **Step 4: Commit final (se houver ajustes do QA)**

```bash
git add -A
git commit -m "fix(home): ajustes do QA da visão financeira"
```

---

## Self-Review (cobertura da spec / Plano 2)

- ✅ KPIs do grupo (receita líquida, despesas, resultado + variação vs mês anterior) — Task 1 (`loadKpisGrupo`) + Task 3.
- ✅ Caixa gerado no mês (entradas − saídas) reusando motor de Fluxo de Caixa — Task 1 (`loadCaixaMes`) + Task 4.
- ✅ Mini-DRE da unidade do franqueado — Task 1 (`loadMiniDreFranqueado`) + Task 5.
- ✅ Franqueado passa a cair em `/home` — Task 2.
- ✅ Indicadores/notícias permanecem no rodapé, abaixo da Visão financeira — já no Plano 1; Task 6 insere a seção financeira acima.
- ✅ Degradação isolada (try/catch por loader) — Task 1.
- ✅ Reuso dos motores DRE/caixa (sem recriar pipeline) — Task 1 importa `loadScopedDreAccounts`/`aggregateDreRows`/`findResultadoExercicio`/`buildCashFlowRows`.

**Consistência de tipos:** `FinProfile` é subset de `UnifiedProfile` (id/role/profile/company_ids — todos existem). `HomeKpis`/`HomeCaixa`/`HomeMiniDre` definidos na Task 1 e consumidos nas Tasks 3-6 com os mesmos nomes de campo. `WidgetCard` (Plano 1) reusado pelos 3 widgets novos.
