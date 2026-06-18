# Home Cockpit — Plano 1 (Fundação + Widgets CTRL)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Sem framework de testes neste repo** (ver CLAUDE.md). Onde o template pede "escreva o teste que falha", a validação aqui é `npm run lint` + `npm run build` + checagem manual no browser. Não invente testes unitários — siga o padrão do projeto.

**Goal:** Transformar a `/home` numa landing role-aware (cockpit) com faixa de atenção e 4 widgets de Controladoria (aprovações com aprovar inline, fila de pagamento, minhas requisições, orçamento do setor), roteando os usuários internos para `/home` no pós-login.

**Architecture:** `home/page.tsx` (server component, já `force-dynamic`) lê `getCurrentSessionContext()`, decide os widgets pela capacidade do usuário e carrega os dados CTRL em paralelo via um módulo `src/lib/home/ctrl-widgets.ts` (admin client). `HomeView` (client) compõe a faixa de atenção + grade de widgets. Aprovação inline reusa a server action `approveRequest`. Cada query é isolada em try/catch — falha de uma não derruba a home.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (admin client / service role), shadcn/ui (`Card`), lucide-react, Tailwind.

**Escopo deste plano (Plano 1):** roteamento + casca + faixa de atenção + 4 widgets CTRL + remoção do bloco "Controll Hub em Números". **Fora (Plano 2):** widgets financeiros (KPIs, Caixa, Mini-DRE), rebaixar indicadores/notícias pro rodapé, e mudar o landing do franqueado para `/home`.

---

## Referências de código (já verificadas)

- `getCurrentSessionContext()` → `{ supabase, user, profile, modules }` (`src/lib/auth/session.ts`). `profile.id`, `profile.sector_ids: string[]`, `modules.ctrl?.roles: CtrlRole[]`.
- `CtrlRole = "admin" | "solicitante" | "gerente" | "diretor" | "csc" | "contas_a_pagar" | "aprovacao_fornecedor"` (`src/lib/supabase/types.ts`).
- `approveRequest(requestId: string, comment?: string)` → `{ ok: true } | { error: string }` (`src/lib/ctrl/actions/requests.ts`).
- `defaultLandingFor(profile, canFinanceiro, canCompras)` (`src/lib/auth/access.ts`); `/home` já está no whitelist `FRANQUEADO_BASE_PATHS`.
- Tabela `ctrl_requests`: `id, request_number, title, amount, due_date, status, created_by, sector_id, reference_year, omie_launch_status, approval_tier`, join `ctrl_suppliers(name)`.
- Tabela `ctrl_budget`: `sector_id, expense_type_id, period_year, period_month, amount, realized`.
- Tabela `ctrl_sectors`: `id, name, active`.
- Status relevantes: pendência de aprovação = `pendente` (etapa gerente) / `pendente_diretor` (etapa diretor); fila pagamento = `aprovado` (a enviar) / `agendado` (enviado); info pedida ao solicitante (aprovação) = `aguardando_complementacao`.
- Lógica de "quem age na etapa" (de `aprovacoes-client.tsx`): `pendente` → gerente/diretor/csc/admin; `pendente_diretor` → diretor/csc/admin.

---

## File Structure

**Criar:**
- `src/lib/home/ctrl-widgets.ts` — tipos + funções de carga dos dados CTRL da home (server-only, admin client).
- `src/components/app/home/widget-card.tsx` — wrapper visual comum (ícone, título, link "ver tudo", estado vazio).
- `src/components/app/home/attention-strip.tsx` — faixa "Precisa da sua atenção".
- `src/components/app/home/widget-aprovacoes.tsx` — widget de aprovações (client, aprovar inline).
- `src/components/app/home/widget-fila-pagamento.tsx` — widget fila de pagamento.
- `src/components/app/home/widget-minhas-requisicoes.tsx` — widget minhas requisições.
- `src/components/app/home/widget-orcamento.tsx` — widget orçamento do setor.

**Modificar:**
- `src/lib/auth/access.ts` — `defaultLandingFor` passa a mandar usuários internos (não-franqueado, não-validador) para `/home`.
- `src/app/(app)/home/page.tsx` — composição role-aware: carrega dados e passa props.
- `src/components/app/home-view.tsx` — novo layout (faixa de atenção + grade de widgets), remove "Controll Hub em Números", mantém Alertas/Indicadores/Notícias num rodapé gated.

---

## Task 1: Módulo de dados dos widgets CTRL

**Files:**
- Create: `src/lib/home/ctrl-widgets.ts`

- [ ] **Step 1: Criar o módulo com tipos e funções de carga**

Crie `src/lib/home/ctrl-widgets.ts` com o conteúdo abaixo. As funções usam o admin client (service role) — a autorização já é feita na página (gate por sessão); o admin client evita que a RLS de `ctrl_requests`/`ctrl_budget` zere dados para papéis específicos (mesmo motivo de `verifyBudget`/contas-a-pagar).

```ts
import { createAdminClient } from "@/lib/supabase/admin";
import type { CtrlRole } from "@/lib/supabase/types";

export const fmtBRL = new Intl.NumberFormat("pt-BR", {
  style: "decimal",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Capacidades derivadas dos papéis CTRL do usuário.
export interface HomeCtrlCaps {
  canApprove: boolean; // vê widget de aprovações
  canPay: boolean; // vê fila de pagamento
  canRequest: boolean; // vê "minhas requisições"
  canBudget: boolean; // vê orçamento do setor
}

export function deriveCtrlCaps(roles: CtrlRole[], sectorIds: string[]): HomeCtrlCaps {
  const has = (...r: CtrlRole[]) => roles.some((x) => r.includes(x));
  return {
    canApprove: has("gerente", "diretor", "csc", "admin"),
    canPay: has("contas_a_pagar", "csc", "admin"),
    canRequest: has("solicitante", "gerente", "diretor", "csc", "admin"),
    canBudget: has("gerente", "diretor") && sectorIds.length > 0,
  };
}

export interface HomeApprovalItem {
  id: string;
  requestNumber: number;
  title: string;
  amount: number;
  status: string;
  supplierName: string | null;
}
export interface HomeApprovals {
  items: HomeApprovalItem[];
  total: number;
}
export interface HomePayments {
  toSend: number;
  dueThisWeek: number;
  omieErrors: number;
}
export interface HomeMyRequests {
  pendentes: number;
  infoPendente: number;
  aprovadas: number;
  rejeitadas: number;
  total: number;
}
export interface HomeBudgetSector {
  sectorId: string;
  sectorName: string;
  orcadoAnual: number;
  consumido: number;
}

export interface HomeCtrlData {
  approvals: HomeApprovals | null;
  payments: HomePayments | null;
  myRequests: HomeMyRequests | null;
  budget: HomeBudgetSector[] | null;
}

// Resolve join de fornecedor (objeto ou array) → nome.
function supplierName(raw: unknown): string | null {
  if (!raw) return null;
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (v as { name?: string } | null)?.name ?? null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function inDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function loadApprovals(roles: CtrlRole[]): Promise<HomeApprovals | null> {
  try {
    const db = createAdminClient();
    const canDirector = roles.some((r) => ["diretor", "csc", "admin"].includes(r));
    const statuses = canDirector ? ["pendente", "pendente_diretor"] : ["pendente"];

    const [{ data: items }, { count }] = await Promise.all([
      db
        .from("ctrl_requests")
        .select("id, request_number, title, amount, status, ctrl_suppliers(name)")
        .in("status", statuses)
        .order("created_at", { ascending: true })
        .limit(5),
      db
        .from("ctrl_requests")
        .select("id", { count: "exact", head: true })
        .in("status", statuses),
    ]);

    return {
      items: (items ?? []).map((r) => ({
        id: r.id as string,
        requestNumber: r.request_number as number,
        title: r.title as string,
        amount: Number(r.amount),
        status: r.status as string,
        supplierName: supplierName(r.ctrl_suppliers),
      })),
      total: count ?? 0,
    };
  } catch {
    return null;
  }
}

async function loadPayments(): Promise<HomePayments | null> {
  try {
    const db = createAdminClient();
    const [{ count: toSend }, { count: dueThisWeek }, { count: omieErrors }] =
      await Promise.all([
        db
          .from("ctrl_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "aprovado"),
        db
          .from("ctrl_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "aprovado")
          .gte("due_date", todayIso())
          .lte("due_date", inDaysIso(7)),
        db
          .from("ctrl_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "agendado")
          .eq("omie_launch_status", "erro"),
      ]);
    return {
      toSend: toSend ?? 0,
      dueThisWeek: dueThisWeek ?? 0,
      omieErrors: omieErrors ?? 0,
    };
  } catch {
    return null;
  }
}

async function loadMyRequests(userId: string): Promise<HomeMyRequests | null> {
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("ctrl_requests")
      .select("status")
      .eq("created_by", userId);
    const rows = data ?? [];
    const count = (...s: string[]) =>
      rows.filter((r) => s.includes(r.status as string)).length;
    return {
      pendentes: count("pendente", "pendente_diretor"),
      infoPendente: count("aguardando_complementacao", "info_pagamento_pendente"),
      aprovadas: count("aprovado", "agendado"),
      rejeitadas: count("rejeitado"),
      total: rows.length,
    };
  } catch {
    return null;
  }
}

async function loadBudget(sectorIds: string[]): Promise<HomeBudgetSector[] | null> {
  try {
    const db = createAdminClient();
    const year = new Date().getFullYear();

    const [{ data: budgets }, { data: reqs }, { data: sectors }] = await Promise.all([
      db
        .from("ctrl_budget")
        .select("sector_id, amount")
        .in("sector_id", sectorIds)
        .eq("period_year", year),
      db
        .from("ctrl_requests")
        .select("sector_id, amount")
        .in("sector_id", sectorIds)
        .eq("reference_year", year)
        .in("status", ["aprovado", "agendado", "info_pagamento_pendente"]),
      db.from("ctrl_sectors").select("id, name").in("id", sectorIds),
    ]);

    const orcado = new Map<string, number>();
    for (const b of budgets ?? [])
      orcado.set(b.sector_id as string, (orcado.get(b.sector_id as string) ?? 0) + Number(b.amount));
    const consumido = new Map<string, number>();
    for (const r of reqs ?? [])
      consumido.set(
        r.sector_id as string,
        (consumido.get(r.sector_id as string) ?? 0) + Number(r.amount),
      );

    return (sectors ?? []).map((s) => ({
      sectorId: s.id as string,
      sectorName: s.name as string,
      orcadoAnual: orcado.get(s.id as string) ?? 0,
      consumido: consumido.get(s.id as string) ?? 0,
    }));
  } catch {
    return null;
  }
}

// Carrega só os widgets que o usuário pode ver, em paralelo.
export async function loadHomeCtrlData(params: {
  userId: string;
  roles: CtrlRole[];
  sectorIds: string[];
  caps: HomeCtrlCaps;
}): Promise<HomeCtrlData> {
  const { userId, roles, sectorIds, caps } = params;
  const [approvals, payments, myRequests, budget] = await Promise.all([
    caps.canApprove ? loadApprovals(roles) : Promise.resolve(null),
    caps.canPay ? loadPayments() : Promise.resolve(null),
    caps.canRequest ? loadMyRequests(userId) : Promise.resolve(null),
    caps.canBudget ? loadBudget(sectorIds) : Promise.resolve(null),
  ]);
  return { approvals, payments, myRequests, budget };
}
```

- [ ] **Step 2: Validar tipos/lint**

Run: `npm run lint`
Expected: `✔ No ESLint warnings or errors` (módulo ainda não importado em lugar nenhum — só checa sintaxe/tipos).

- [ ] **Step 3: Commit**

```bash
git add src/lib/home/ctrl-widgets.ts
git commit -m "feat(home): módulo de dados dos widgets CTRL da home"
```

---

## Task 2: Roteamento pós-login para /home

**Files:**
- Modify: `src/lib/auth/access.ts` (`defaultLandingFor`)

- [ ] **Step 1: Alterar `defaultLandingFor`**

Em `src/lib/auth/access.ts`, substitua a função `defaultLandingFor` por:

```ts
export function defaultLandingFor(
  profile: UserProfileType,
  canFinanceiro: boolean,
  canCompras: boolean,
): string {
  // Ilha de contratos — não passa pela home.
  if (profile === "validador_contrato") return "/contratos";
  // Franqueado: mantém /dashboard até o Plano 2 entregar o widget Mini-DRE dele.
  if (profile === "franqueado") return "/dashboard";
  // Demais perfis com algum módulo → cockpit /home.
  if (canFinanceiro || canCompras || profile === "admin") return "/home";
  return "/pendente";
}
```

- [ ] **Step 2: Validar lint + build**

Run: `npm run lint && npm run build`
Expected: lint limpo; build conclui sem erros de tipo.

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/access.ts
git commit -m "feat(home): pós-login leva usuários internos para /home"
```

---

## Task 3: Componente WidgetCard (wrapper visual)

**Files:**
- Create: `src/components/app/home/widget-card.tsx`

- [ ] **Step 1: Criar o wrapper**

Crie `src/components/app/home/widget-card.tsx`:

```tsx
"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function WidgetCard({
  title,
  icon: Icon,
  href,
  hrefLabel = "Ver tudo",
  children,
}: {
  title: string;
  icon: LucideIcon;
  href: string;
  hrefLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="rounded-lg border bg-background">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Icon className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {hrefLabel}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function WidgetEmpty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-center text-sm text-muted-foreground">{children}</p>;
}
```

- [ ] **Step 2: Validar lint**

Run: `npm run lint`
Expected: limpo.

- [ ] **Step 3: Commit**

```bash
git add src/components/app/home/widget-card.tsx
git commit -m "feat(home): WidgetCard wrapper visual"
```

---

## Task 4: Widget de Aprovações (com aprovar inline)

**Files:**
- Create: `src/components/app/home/widget-aprovacoes.tsx`

- [ ] **Step 1: Criar o widget**

Crie `src/components/app/home/widget-aprovacoes.tsx`. Reusa a server action `approveRequest`; após aprovar, `router.refresh()` recarrega os dados do server component.

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, Loader2 } from "lucide-react";

import { approveRequest } from "@/lib/ctrl/actions/requests";
import { WidgetCard, WidgetEmpty } from "@/components/app/home/widget-card";
import { fmtBRL, type HomeApprovals } from "@/lib/home/ctrl-widgets";

export function WidgetAprovacoes({ data }: { data: HomeApprovals }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function aprovar(id: string) {
    setBusyId(id);
    setError(null);
    startTransition(async () => {
      const res = await approveRequest(id);
      setBusyId(null);
      if (res && "error" in res && res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <WidgetCard title="Aprovações pendentes" icon={CheckSquare} href="/ctrl/aprovacoes">
      {error && (
        <p className="mb-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {data.items.length === 0 ? (
        <WidgetEmpty>Nenhuma requisição aguardando você.</WidgetEmpty>
      ) : (
        <ul className="divide-y">
          {data.items.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.title}</p>
                <p className="text-xs text-muted-foreground">
                  #{r.requestNumber}
                  {r.supplierName ? ` · ${r.supplierName}` : ""} · {fmtBRL.format(r.amount)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => aprovar(r.id)}
                disabled={isPending && busyId === r.id}
                className="inline-flex shrink-0 items-center gap-1 rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {isPending && busyId === r.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                Aprovar
              </button>
            </li>
          ))}
        </ul>
      )}
      {data.total > data.items.length && (
        <p className="mt-2 text-xs text-muted-foreground">
          +{data.total - data.items.length} aguardando — veja todas em Aprovações.
        </p>
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
git add src/components/app/home/widget-aprovacoes.tsx
git commit -m "feat(home): widget de aprovações com aprovar inline"
```

---

## Task 5: Widget Fila de Pagamento

**Files:**
- Create: `src/components/app/home/widget-fila-pagamento.tsx`

- [ ] **Step 1: Criar o widget**

Crie `src/components/app/home/widget-fila-pagamento.tsx`:

```tsx
"use client";

import { Wallet } from "lucide-react";

import { WidgetCard } from "@/components/app/home/widget-card";
import type { HomePayments } from "@/lib/home/ctrl-widgets";

export function WidgetFilaPagamento({ data }: { data: HomePayments }) {
  return (
    <WidgetCard title="Fila de pagamento" icon={Wallet} href="/ctrl/contas-a-pagar">
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-2xl font-bold">{data.toSend}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">A enviar</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-amber-600">{data.dueThisWeek}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Vencendo (7 dias)</p>
        </div>
        <div>
          <p className={`text-2xl font-bold ${data.omieErrors > 0 ? "text-red-600" : ""}`}>
            {data.omieErrors}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">Falhas Omie</p>
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
git add src/components/app/home/widget-fila-pagamento.tsx
git commit -m "feat(home): widget fila de pagamento"
```

---

## Task 6: Widget Minhas Requisições

**Files:**
- Create: `src/components/app/home/widget-minhas-requisicoes.tsx`

- [ ] **Step 1: Criar o widget**

Crie `src/components/app/home/widget-minhas-requisicoes.tsx`:

```tsx
"use client";

import Link from "next/link";
import { FileText, Plus } from "lucide-react";

import { WidgetCard, WidgetEmpty } from "@/components/app/home/widget-card";
import type { HomeMyRequests } from "@/lib/home/ctrl-widgets";

export function WidgetMinhasRequisicoes({ data }: { data: HomeMyRequests }) {
  return (
    <WidgetCard
      title="Minhas requisições"
      icon={FileText}
      href="/ctrl/requisicoes"
      hrefLabel="Ver todas"
    >
      {data.total === 0 ? (
        <WidgetEmpty>Você ainda não criou requisições.</WidgetEmpty>
      ) : (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Stat label="Pendentes" value={data.pendentes} />
          <Stat label="Info pedida" value={data.infoPendente} highlight={data.infoPendente > 0} />
          <Stat label="Aprovadas" value={data.aprovadas} />
          <Stat label="Rejeitadas" value={data.rejeitadas} />
        </div>
      )}
      <Link
        href="/ctrl/requisicoes/nova"
        className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <Plus className="h-3.5 w-3.5" />
        Nova requisição
      </Link>
    </WidgetCard>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <p className={`text-lg font-bold ${highlight ? "text-amber-600" : ""}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
```

- [ ] **Step 2: Validar lint**

Run: `npm run lint`
Expected: limpo.

- [ ] **Step 3: Commit**

```bash
git add src/components/app/home/widget-minhas-requisicoes.tsx
git commit -m "feat(home): widget minhas requisições"
```

---

## Task 7: Widget Orçamento do Setor

**Files:**
- Create: `src/components/app/home/widget-orcamento.tsx`

- [ ] **Step 1: Criar o widget**

Crie `src/components/app/home/widget-orcamento.tsx`. Mostra, por setor do usuário, orçado anual vs consumido (requisições aprovadas/enviadas do ano). É uma visão de relance; a fonte autoritativa é `/ctrl/orcamento` (link).

```tsx
"use client";

import { PiggyBank } from "lucide-react";

import { WidgetCard, WidgetEmpty } from "@/components/app/home/widget-card";
import { fmtBRL, type HomeBudgetSector } from "@/lib/home/ctrl-widgets";

export function WidgetOrcamento({ data }: { data: HomeBudgetSector[] }) {
  return (
    <WidgetCard title="Orçamento do setor" icon={PiggyBank} href="/ctrl/orcamento">
      {data.length === 0 ? (
        <WidgetEmpty>Sem orçamento cadastrado para seus setores.</WidgetEmpty>
      ) : (
        <ul className="space-y-3">
          {data.map((s) => {
            const pct =
              s.orcadoAnual > 0
                ? Math.min(100, Math.round((s.consumido / s.orcadoAnual) * 100))
                : 0;
            const over = s.orcadoAnual > 0 && s.consumido > s.orcadoAnual;
            return (
              <li key={s.sectorId} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{s.sectorName}</span>
                  <span className="text-xs text-muted-foreground">
                    {fmtBRL.format(s.consumido)} / {fmtBRL.format(s.orcadoAnual)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${over ? "bg-red-500" : "bg-violet-500"}`}
                    style={{ width: `${over ? 100 : pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
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
git add src/components/app/home/widget-orcamento.tsx
git commit -m "feat(home): widget orçamento do setor"
```

---

## Task 8: Faixa de atenção

**Files:**
- Create: `src/components/app/home/attention-strip.tsx`

- [ ] **Step 1: Criar a faixa**

Crie `src/components/app/home/attention-strip.tsx`. Recebe os dados já carregados e monta os itens "quentes". Se nada quente, mostra mensagem neutra.

```tsx
"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import type { HomeCtrlData } from "@/lib/home/ctrl-widgets";

interface AttentionItem {
  label: string;
  href: string;
}

function buildItems(data: HomeCtrlData): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (data.approvals && data.approvals.total > 0) {
    items.push({
      label: `${data.approvals.total} aprovação(ões) aguardando você`,
      href: "/ctrl/aprovacoes",
    });
  }
  if (data.payments && data.payments.omieErrors > 0) {
    items.push({
      label: `${data.payments.omieErrors} falha(s) no envio ao Omie`,
      href: "/ctrl/contas-a-pagar",
    });
  }
  if (data.myRequests && data.myRequests.infoPendente > 0) {
    items.push({
      label: `${data.myRequests.infoPendente} requisição(ões) com info pedida`,
      href: "/ctrl/requisicoes",
    });
  }
  if (data.myRequests && data.myRequests.rejeitadas > 0) {
    items.push({
      label: `${data.myRequests.rejeitadas} requisição(ões) rejeitada(s)`,
      href: "/ctrl/requisicoes",
    });
  }
  return items;
}

export function AttentionStrip({ data }: { data: HomeCtrlData }) {
  const items = buildItems(data);

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-5 py-3 text-sm text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        Tudo em dia. Nada precisa da sua atenção agora.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-3 dark:border-amber-900 dark:bg-amber-950/30">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        Precisa da sua atenção
      </div>
      <ul className="flex flex-wrap gap-2">
        {items.map((it, i) => (
          <li key={i}>
            <Link
              href={it.href}
              className="inline-flex rounded-full border border-amber-300 bg-white/70 px-3 py-1 text-xs font-medium text-amber-900 transition-colors hover:bg-white dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
            >
              {it.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Validar lint**

Run: `npm run lint`
Expected: limpo.

- [ ] **Step 3: Commit**

```bash
git add src/components/app/home/attention-strip.tsx
git commit -m "feat(home): faixa de atenção"
```

---

## Task 9: Compor a home (page + view)

**Files:**
- Modify: `src/app/(app)/home/page.tsx`
- Modify: `src/components/app/home-view.tsx`

- [ ] **Step 1: Reescrever `home/page.tsx`**

Substitua todo o conteúdo de `src/app/(app)/home/page.tsx` por:

```tsx
import { redirect } from "next/navigation";

import { HomeView } from "@/components/app/home-view";
import { getCurrentSessionContext } from "@/lib/auth/session";
import {
  deriveCtrlCaps,
  loadHomeCtrlData,
  type HomeCtrlData,
} from "@/lib/home/ctrl-widgets";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { user, profile, modules } = await getCurrentSessionContext();
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

  return (
    <HomeView
      userName={userName}
      caps={caps}
      ctrlData={ctrlData}
      canFinanceiro={canFinanceiro}
    />
  );
}
```

- [ ] **Step 2: Reescrever `home-view.tsx`**

Substitua todo o conteúdo de `src/components/app/home-view.tsx` por. Mantém Alertas/Indicadores/Notícias num rodapé gated a `canFinanceiro` (client fetch, como hoje) e **remove o bloco "Controll Hub em Números"**. A grade de widgets só renderiza os que o usuário pode ver.

```tsx
"use client";

import { useEffect, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AttentionStrip } from "@/components/app/home/attention-strip";
import { WidgetAprovacoes } from "@/components/app/home/widget-aprovacoes";
import { WidgetFilaPagamento } from "@/components/app/home/widget-fila-pagamento";
import { WidgetMinhasRequisicoes } from "@/components/app/home/widget-minhas-requisicoes";
import { WidgetOrcamento } from "@/components/app/home/widget-orcamento";
import type { HomeCtrlCaps, HomeCtrlData } from "@/lib/home/ctrl-widgets";

interface Indicator {
  name: string;
  value: string;
  change: string;
  changeType: "up" | "down" | "neutral";
  color: string;
  label: string;
}
interface Alert {
  type: "error" | "warning" | "info";
  title: string;
  detail: string;
}
interface NewsItem {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
}

interface HomeViewProps {
  userName: string;
  caps: HomeCtrlCaps;
  ctrlData: HomeCtrlData;
  canFinanceiro: boolean;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}
function changeColor(type: "up" | "down" | "neutral"): string {
  if (type === "up") return "#16a34a";
  if (type === "down") return "#dc2626";
  return "#64748b";
}
function alertDotColor(type: string): string {
  if (type === "error") return "bg-red-500";
  if (type === "warning") return "bg-amber-400";
  return "bg-blue-400";
}

export function HomeView({ userName, caps, ctrlData, canFinanceiro }: HomeViewProps) {
  const [indicators, setIndicators] = useState<Indicator[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loadingIndicators, setLoadingIndicators] = useState(true);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [loadingNews, setLoadingNews] = useState(true);

  useEffect(() => {
    if (!canFinanceiro) return;
    void fetch("/api/home/indicators")
      .then((r) => r.json())
      .then((d: { indicators: Indicator[] }) => setIndicators(d.indicators ?? []))
      .finally(() => setLoadingIndicators(false));
    void fetch("/api/home/stats")
      .then((r) => r.json())
      .then((d: { alerts: Alert[] }) => setAlerts(d.alerts ?? []))
      .finally(() => setLoadingAlerts(false));
    void fetch("/api/home/news")
      .then((r) => r.json())
      .then((d: { news: NewsItem[] }) => setNews(d.news ?? []))
      .finally(() => setLoadingNews(false));
  }, [canFinanceiro]);

  const greeting = getGreeting();
  const currentDate = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const formattedDate = currentDate.charAt(0).toUpperCase() + currentDate.slice(1);

  const hasAnyWidget =
    (caps.canApprove && ctrlData.approvals) ||
    (caps.canPay && ctrlData.payments) ||
    (caps.canRequest && ctrlData.myRequests) ||
    (caps.canBudget && ctrlData.budget);

  return (
    <div className="space-y-6 p-6">
      {/* Saudação */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {greeting}, {userName}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{formattedDate}</p>
      </div>

      {/* Faixa de atenção */}
      <AttentionStrip data={ctrlData} />

      {/* Grade de widgets */}
      {hasAnyWidget && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {caps.canApprove && ctrlData.approvals && (
            <WidgetAprovacoes data={ctrlData.approvals} />
          )}
          {caps.canPay && ctrlData.payments && (
            <WidgetFilaPagamento data={ctrlData.payments} />
          )}
          {caps.canRequest && ctrlData.myRequests && (
            <WidgetMinhasRequisicoes data={ctrlData.myRequests} />
          )}
          {caps.canBudget && ctrlData.budget && (
            <WidgetOrcamento data={ctrlData.budget} />
          )}
        </div>
      )}

      {/* Rodapé financeiro (gestão/financeiro) — Plano 2 expande com KPIs e Caixa */}
      {canFinanceiro && (
        <>
          <section>
            <h2 className="mb-3 text-base font-semibold">Indicadores Econômicos</h2>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {loadingIndicators
                ? Array.from({ length: 4 }).map((_, i) => (
                    <Card key={i} className="rounded-lg border bg-background">
                      <CardContent className="space-y-2 p-4">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-7 w-20" />
                        <Skeleton className="h-4 w-16" />
                      </CardContent>
                    </Card>
                  ))
                : indicators.map((ind) => (
                    <Card key={ind.name} className="rounded-lg border bg-background">
                      <CardContent className="p-4">
                        <div className="mb-1 flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
                            style={{ backgroundColor: ind.color }}
                          />
                          <span className="truncate text-xs text-muted-foreground">
                            {ind.label}
                          </span>
                        </div>
                        <p className="text-2xl font-bold tracking-tight">{ind.value}</p>
                        <p
                          className="mt-1 text-xs font-medium"
                          style={{ color: changeColor(ind.changeType) }}
                        >
                          {ind.change}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
            </div>
          </section>

          <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card className="rounded-lg border bg-background">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Alertas do Sistema</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {loadingAlerts ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <Skeleton className="mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full" />
                      <div className="flex-1 space-y-1">
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="h-3 w-56" />
                      </div>
                    </div>
                  ))
                ) : alerts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum alerta no momento.</p>
                ) : (
                  alerts.map((alert, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <span
                        className={`mt-1.5 inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full ${alertDotColor(alert.type)}`}
                      />
                      <div>
                        <p className="text-sm font-medium leading-tight">{alert.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{alert.detail}</p>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="rounded-lg border bg-background">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Notícias Econômicas</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {loadingNews ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="space-y-1 px-3 py-2.5">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                  ))
                ) : news.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-muted-foreground">
                    Nenhuma notícia disponível no momento.
                  </p>
                ) : (
                  news.map((item, i) => (
                    <a
                      key={i}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center justify-between rounded-md px-3 py-2.5 transition-colors hover:bg-muted/60"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm font-medium transition-colors group-hover:text-primary">
                          {item.title}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {item.source}
                          {item.publishedAt ? ` · ${item.publishedAt}` : ""}
                        </p>
                      </div>
                    </a>
                  ))
                )}
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Validar lint + build**

Run: `npm run lint && npm run build`
Expected: lint limpo; build conclui. Se o build acusar import não usado (ex: `CheckSquare` antigo), remova-o.

- [ ] **Step 4: Commit**

```bash
git add src/app/(app)/home/page.tsx src/components/app/home-view.tsx
git commit -m "feat(home): cockpit role-aware (faixa de atenção + grade de widgets)"
```

---

## Task 10: QA manual e fechamento

**Files:** nenhum (verificação).

- [ ] **Step 1: Rodar o app**

Run: `npm run dev`
Abra `http://localhost:3000/home`.

- [ ] **Step 2: Checklist manual de papéis**

Verifique, logando (ou simulando) com perfis diferentes:
- **Diretor/Gerente:** vê widget de Aprovações; botão "Aprovar" aprova e a lista some/atualiza; faixa de atenção mostra a contagem.
- **Contas a pagar/CSC:** vê Fila de pagamento com os 3 números.
- **Solicitante:** vê Minhas requisições + botão "Nova requisição"; itens com info pedida aparecem na faixa de atenção.
- **Gerente/Diretor com setor:** vê Orçamento do setor com barra consumido/orçado.
- **Financeiro/admin:** vê o rodapé com Indicadores/Alertas/Notícias; **não** vê mais "Controll Hub em Números".
- **Usuário só com financeiro (sem CTRL):** vê saudação + faixa "Tudo em dia" + rodapé financeiro (sem widgets CTRL) — página não quebra.

- [ ] **Step 3: Confirmar roteamento pós-login**

Faça logout/login com um usuário interno (não franqueado) e confirme que cai em `/home`. Franqueado deve continuar caindo em `/dashboard`.

- [ ] **Step 4: Commit final (se houver ajustes do QA)**

```bash
git add -A
git commit -m "fix(home): ajustes do QA do cockpit"
```

---

## Self-Review (cobertura da spec)

- ✅ `/home` vira landing pós-login (Task 2; franqueado adiado pro Plano 2, conforme acordado).
- ✅ Role-aware por capacidade (`deriveCtrlCaps`, Task 1 + gating na Task 9).
- ✅ Layout C: saudação → faixa de atenção → grade de widgets → rodapé financeiro (Task 9).
- ✅ Faixa de atenção com itens quentes (Task 8).
- ✅ Widgets Aprovações (inline approve), Fila de pagamento, Minhas requisições, Orçamento (Tasks 4-7).
- ✅ "Controll Hub em Números" removido (Task 9).
- ✅ Degradação isolada via try/catch por query (Task 1).
- ⏭️ Widgets financeiros (KPIs, Caixa, Mini-DRE) e franqueado → Plano 2 (fora de escopo).
