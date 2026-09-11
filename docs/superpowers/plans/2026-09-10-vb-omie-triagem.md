# VB — Triagem dos pagamentos da Omie (ABD Holding) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tela `/vb/omie` onde o gestor do VB vê os pagamentos da ABD Holding já sincronizados da Omie (desde 10/09/2026) e decide, um a um, descartar ou vincular a credores como lançamentos do VB.

**Architecture:** Nenhuma integração nova: a tela lê `financial_entries` (sync diário do DRE) filtrando empresa, tipo e data; a decisão por movimento vive na tabela nova `vb_omie_triage` (chave única por `omie_id`, com retrato do pagamento); pendente = candidato sem decisão. Vincular reaproveita o diálogo multi-linha e `buildEntryRows`, gravando lançamentos + decisão com compensação. Lógica de sugestão é pura e testada; leituras e escritas usam o admin client depois de `requireVbGestor()`.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Supabase (Postgres + RLS, service role), zod v4, shadcn/ui + Tailwind, node test runner via tsx (`npm test`).

**Spec:** `docs/superpowers/specs/2026-09-10-vb-omie-triagem-design.md`

## Global Constraints

- Empresa fixa: `VB_OMIE_COMPANY_ID = "85ce50b8-571a-49d2-b279-9a8d08cbe4ae"` (ABD Holding); recorte `VB_OMIE_START_DATE = "2026-09-10"` (inclusivo); tipos `VB_OMIE_TYPES = ["despesa"]`.
- Uma decisão por movimento: `UNIQUE (company_id, omie_id)` em `vb_omie_triage`; status só `'vinculado' | 'descartado'`; vinculado exige `group_id`.
- Pendente NÃO é gravado: é candidato sem linha na triagem.
- Toda leitura e escrita desta feature usa `createAdminClient()` **depois** de `requireVbGestor()` (ou do gate de gestor na página). Nenhuma função `SECURITY DEFINER` nova.
- Vincular grava os lançamentos (um INSERT) e depois a decisão; se a decisão falhar, apaga os lançamentos do `group_id` e devolve erro. Violação da chave única → mensagem "Este movimento já foi decidido."
- O total das linhas não precisa bater com o valor da Omie (só aviso âmbar).
- Sugestão de tipo por categoria: `2.05.03` → saida, `2.05.01` → saida, `2.10.98` → entrada, demais → saida. Sugestão de credor: memória (último vínculo do mesmo `supplier_customer`, credor da linha `sort_order = 0`) antes do nome; nome casa por tokens distintos, na ordem; só ativos; ambíguo → sem sugestão.
- Botão "Buscar na Omie" chama `runCompanySyncAsSystem(VB_OMIE_COMPANY_ID, "rolling")`; recusa quando existe `sync_log` `running` iniciado há menos de 5 minutos.
- A interface nunca mostra a palavra "planilha" nem marca origem Omie no extrato do credor. Textos ao usuário em português; mensagens técnicas em inglês.
- Testes: node test runner (`node:test`, `node:assert/strict`), arquivos `*.test.ts`/`*.test.tsx` em `src/`. Sem `downlevelIteration`: não espalhe iteradores (`Array.from(map.entries())`).
- **Não rode `npm run build`** (o dev server do dono pode estar de pé e o build corrompe a `.next`). Valide com `npm run lint`, `npm test` e `npx tsc --noEmit`.
- A migration é **aplicada pelo controlador** (MCP do Supabase, projeto `hlophikvgtqoexqwxxis`), não pelo implementador — o implementador só cria o arquivo.
- Commits em português, prefixo `feat(vb):`/`test(vb):`/`docs(vb):`, terminando com `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260910130000_vb_omie_triage.sql` | Tabela `vb_omie_triage`, índices, trigger, RLS (SELECT gestor). |
| `src/lib/vb/omie/config.ts` | Constantes: empresa, recorte, tipos, mapa categoria→tipo, janela de sync em andamento. |
| `src/lib/vb/types.ts` (modificar) | Tipos `VbCreditorOption`, `VbOmieMovement`, `VbOmieTriageStatus`, `VbOmieLinkedEntry`, `VbOmieTriageRow`, `VbOmieSyncStatus`, `VbEntryPrefill`. |
| `src/lib/auth/vb.ts` (modificar) | `VB_NAV_KEY_OMIE`, `VB_OMIE_PATH`. |
| `src/lib/vb/omie/suggest.ts` + `suggest.test.ts` | Lógica pura: candidato, sugestão de tipo/credor, prefill. |
| `src/lib/vb/new-entries.ts` (modificar) + `new-entries.test.ts` | `sumTypedLines` (totais do diálogo, puro). |
| `src/lib/vb/omie/queries.ts` | Leituras (admin client): pendentes, contagem, triagem por status, memória, status do sync. |
| `src/lib/vb/actions/omie.ts` | Server actions: descartar, restaurar, vincular, desvincular, sincronizar. |
| `src/components/vb/new-entry-dialog.tsx` (reescrever) | `VbEntryDialog` (controlado, com modo Omie) + `VbNewEntryDialog` (botão). |
| `src/components/vb/omie-pending-table.tsx` + `.test.tsx` | Tabela de pendentes, sem Radix (testável por SSR). |
| `src/components/vb/omie-triage.tsx` | Container client: abas, filtros, ações, confirmação, diálogo de vínculo. |
| `src/app/(vb)/vb/omie/page.tsx` | Página server: gate de gestor, carga, cabeçalho. |
| `src/components/app/navigation.ts`, `nav-links.tsx`, `app-shell.tsx`, `src/app/(vb)/vb/layout.tsx` (modificar) | Item "Omie" no grupo VB com badge de pendentes. |
| `src/app/(vb)/vb/page.tsx` (modificar) | Faixa "N pagamentos da Omie aguardam triagem". |
| `CLAUDE.md` (modificar) | Parágrafo "Triagem da Omie" na seção do VB. |

---

### Task 1: Migration, constantes e tipos

**Files:**
- Create: `supabase/migrations/20260910130000_vb_omie_triage.sql`
- Create: `src/lib/vb/omie/config.ts`
- Modify: `src/lib/vb/types.ts` (fim do arquivo)
- Modify: `src/lib/auth/vb.ts:27-28`

**Interfaces:**
- Consumes: `VbEntryKind`, `VbCreditor` de `src/lib/vb/types.ts`.
- Produces: constantes `VB_OMIE_COMPANY_ID`, `VB_OMIE_COMPANY_NAME`, `VB_OMIE_START_DATE`, `VB_OMIE_TYPES`, `VB_OMIE_KIND_BY_CATEGORY`, `VB_OMIE_SYNC_RUNNING_WINDOW_MS`; tipos `VbCreditorOption`, `VbOmieMovement`, `VbOmieTriageStatus`, `VbOmieLinkedEntry`, `VbOmieTriageRow`, `VbOmieSyncStatus`, `VbEntryPrefill`; `VB_NAV_KEY_OMIE = "vb-omie"`, `VB_OMIE_PATH = "/vb/omie"`.

- [ ] **Step 1: Criar a migration** (só o arquivo; quem aplica é o controlador)

```sql
-- supabase/migrations/20260910130000_vb_omie_triage.sql
-- Triagem dos pagamentos da ABD Holding (financial_entries) no VB.
-- Uma decisão por movimento da Omie. Pendente não é gravado: é candidato sem
-- linha aqui. Guarda o retrato do pagamento porque o sync apaga movimentos
-- que somem da Omie (cleanup_obsolete_entries) e a decisão precisa sobreviver.
CREATE TABLE IF NOT EXISTS public.vb_omie_triage (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  omie_id            TEXT NOT NULL,
  financial_entry_id UUID NULL REFERENCES public.financial_entries(id) ON DELETE SET NULL,
  status             TEXT NOT NULL CHECK (status IN ('vinculado', 'descartado')),
  -- Vinculado: grupo dos lançamentos criados (vb_entries.group_id).
  group_id           UUID NULL,
  payment_date       DATE NOT NULL,
  supplier_customer  TEXT NULL,
  description        TEXT NULL,
  category_code      TEXT NULL,
  category_name      TEXT NULL,
  value              NUMERIC(14,2) NOT NULL,
  decided_by         UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vb_omie_triage_one_decision UNIQUE (company_id, omie_id),
  CONSTRAINT vb_omie_triage_linked_has_group CHECK (status <> 'vinculado' OR group_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS vb_omie_triage_group_idx
  ON public.vb_omie_triage (group_id) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vb_omie_triage_supplier_idx
  ON public.vb_omie_triage (company_id, supplier_customer, decided_at DESC);

DROP TRIGGER IF EXISTS vb_omie_triage_touch_updated_at ON public.vb_omie_triage;
CREATE TRIGGER vb_omie_triage_touch_updated_at
  BEFORE UPDATE ON public.vb_omie_triage
  FOR EACH ROW EXECUTE FUNCTION public.vb_touch_updated_at();

ALTER TABLE public.vb_omie_triage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vb_omie_triage_select ON public.vb_omie_triage;
CREATE POLICY vb_omie_triage_select ON public.vb_omie_triage
  FOR SELECT TO authenticated USING (public.vb_role() = 'gestor');
-- Sem policy de escrita: só o service role grava (actions depois de requireVbGestor()).

COMMENT ON TABLE public.vb_omie_triage IS
  'Decisão do gestor do VB sobre cada pagamento da ABD Holding vindo da Omie: descartado ou vinculado (group_id dos lançamentos).';
```

- [ ] **Step 2: Criar as constantes**

```ts
// src/lib/vb/omie/config.ts
// Triagem da Omie: só a ABD Holding, só pagamentos, só a partir do dia em que
// o VB passou a ser o sistema (antes disso o extrato importado já cobre).
// Empresa fixada por id no código, como em @/lib/auth/restricted-companies.

import type { VbEntryKind } from "@/lib/vb/types";

export const VB_OMIE_COMPANY_ID = "85ce50b8-571a-49d2-b279-9a8d08cbe4ae"; // ABD Holding
export const VB_OMIE_COMPANY_NAME = "ABD Holding";
/** Inclusivo ('YYYY-MM-DD'). */
export const VB_OMIE_START_DATE = "2026-09-10";
/** Tipos de financial_entries que entram na triagem. Recebimentos: acrescentar "receita". */
export const VB_OMIE_TYPES: readonly string[] = ["despesa"];
/** Tipo sugerido pela categoria da Omie; fora do mapa é saída (é um pagamento). */
export const VB_OMIE_KIND_BY_CATEGORY: Readonly<Record<string, VbEntryKind>> = {
  "2.05.03": "saida", // Pagamento de Empréstimos (resgate)
  "2.05.01": "saida", // Juros sobre Empréstimos (juros pagos em dinheiro)
  "2.10.98": "entrada", // Pagamento de Dividendo (Anual) deixado no VB
};
/** Um sync 'running' mais velho que isso é lixo de execução interrompida, não trava o botão. */
export const VB_OMIE_SYNC_RUNNING_WINDOW_MS = 5 * 60 * 1000;
```

- [ ] **Step 3: Acrescentar os tipos ao fim de `src/lib/vb/types.ts`**

```ts
/** O que o formulário de lançamento precisa saber de um credor. */
export type VbCreditorOption = Pick<VbCreditor, "id" | "name" | "active">;

/** Pagamento da ABD Holding como está hoje em financial_entries. */
export interface VbOmieMovement {
  /** financial_entries.id (muda se o sync recriar a linha; a chave é omie_id). */
  id: string;
  omie_id: string;
  /** 'YYYY-MM-DD' */
  payment_date: string;
  supplier_customer: string | null;
  description: string | null;
  category_code: string | null;
  category_name: string | null;
  /** Sempre positivo; o tipo (despesa) dá a direção. */
  value: number;
  document_number: string | null;
}

export type VbOmieTriageStatus = "vinculado" | "descartado";

export interface VbOmieLinkedEntry {
  id: string;
  creditor_id: string;
  creditor_name: string;
  kind: VbEntryKind;
  amount: number;
  sort_order: number;
}

/** Decisão gravada + retrato + o que existe hoje (para os avisos). */
export interface VbOmieTriageRow {
  id: string;
  omie_id: string;
  status: VbOmieTriageStatus;
  group_id: string | null;
  payment_date: string;
  supplier_customer: string | null;
  description: string | null;
  category_code: string | null;
  category_name: string | null;
  value: number;
  decided_by_name: string | null;
  decided_at: string;
  /** Movimento como está hoje na Omie; null = não consta mais. */
  live: { value: number } | null;
  /** Só vinculado: lançamentos do grupo, em sort_order. */
  entries: VbOmieLinkedEntry[];
}

export interface VbOmieSyncStatus {
  /** Fim do último sync com sucesso (ISO) ou null. */
  finishedAt: string | null;
  /** Há um sync em andamento (iniciado há menos de VB_OMIE_SYNC_RUNNING_WINDOW_MS). */
  running: boolean;
}

/** Valores iniciais do diálogo de lançamento (valor como string BR, ex.: "330000" ou "1234,5"). */
export interface VbEntryPrefill {
  date: string;
  description: string;
  lines: Array<{ creditorId: string; kind: VbEntryKind; amount: string }>;
}
```

- [ ] **Step 4: Chaves de navegação em `src/lib/auth/vb.ts`** — logo abaixo de `VB_NAV_KEY_IMPORT`:

```ts
export const VB_NAV_KEY_OMIE = "vb-omie";
export const VB_OMIE_PATH = "/vb/omie";
```

- [ ] **Step 5: Validar e commitar**

Run: `npx tsc --noEmit && npm run lint`
Expected: sem erros.

```bash
git add supabase/migrations/20260910130000_vb_omie_triage.sql src/lib/vb/omie/config.ts src/lib/vb/types.ts src/lib/auth/vb.ts
git commit -m "feat(vb): tabela vb_omie_triage, constantes e tipos da triagem da Omie

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 2: Lógica pura de sugestão e prefill

**Files:**
- Create: `src/lib/vb/omie/suggest.ts`
- Test: `src/lib/vb/omie/suggest.test.ts`

**Interfaces:**
- Consumes: `VB_OMIE_COMPANY_ID`, `VB_OMIE_START_DATE`, `VB_OMIE_TYPES`, `VB_OMIE_KIND_BY_CATEGORY` (Task 1); tipos `VbCreditorOption`, `VbOmieMovement`, `VbEntryPrefill`, `VbEntryKind`; `numberToInput` de `@/lib/orcamento/format`.
- Produces:
  - `normalizeTokens(value: string | null | undefined): string[]`
  - `matchesSupplier(creditorName: string, supplier: string | null): boolean`
  - `suggestCreditor(supplier: string | null, creditors: readonly VbCreditorOption[], memory: Readonly<Record<string, string>>): string | null`
  - `suggestKind(categoryCode: string | null): VbEntryKind`
  - `isCandidateMovement(row: { company_id: string; type: string; payment_date: string }): boolean`
  - `prefillFromMovement(movement: VbOmieMovement, creditors: readonly VbCreditorOption[], memory: Readonly<Record<string, string>>): VbEntryPrefill`
  - `VB_OMIE_DESCRIPTION_MAX = 300`

- [ ] **Step 1: Escrever os testes (falham: módulo não existe)**

```ts
// src/lib/vb/omie/suggest.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { VB_OMIE_COMPANY_ID, VB_OMIE_START_DATE } from "@/lib/vb/omie/config";
import {
  isCandidateMovement,
  matchesSupplier,
  normalizeTokens,
  prefillFromMovement,
  suggestCreditor,
  suggestKind,
} from "@/lib/vb/omie/suggest";
import type { VbCreditorOption, VbOmieMovement } from "@/lib/vb/types";

const CREDITORS: VbCreditorOption[] = [
  { id: "c-renato", name: "Renato", active: true },
  { id: "c-maria", name: "Maria Ap", active: true },
  { id: "c-pedro", name: "Pedro P", active: true },
  { id: "c-sotrate", name: "Sotrate", active: true },
  { id: "c-renan", name: "Renan", active: false },
];

function movement(over: Partial<VbOmieMovement> = {}): VbOmieMovement {
  return {
    id: "fe-1",
    omie_id: "mov:cc:1",
    payment_date: "2026-09-12",
    supplier_customer: "FERNANDO SOTRATE FERREIRA",
    description: "RESGATE VB",
    category_code: "2.05.03",
    category_name: "Pagamento de Empréstimos",
    value: 330000,
    document_number: null,
    ...over,
  };
}

test("normalizeTokens tira acento, caixa e pontuação", () => {
  assert.deepEqual(normalizeTokens("MARIA APARECIDA - CONTA BRADESCO"), ["maria", "aparecida", "conta", "bradesco"]);
  assert.deepEqual(normalizeTokens("Sotrate"), ["sotrate"]);
  assert.deepEqual(normalizeTokens(null), []);
});

test("matchesSupplier: cada token do credor é prefixo de um token distinto do fornecedor, na ordem", () => {
  assert.equal(matchesSupplier("Maria Ap", "MARIA APARECIDA GOMES ALMEIDA"), true);
  assert.equal(matchesSupplier("Sotrate", "FERNANDO SOTRATE FERREIRA"), true);
  assert.equal(matchesSupplier("Pedro P", "PEDRO PAULO"), true);
  // O "P" não pode reaproveitar o token PEDRO.
  assert.equal(matchesSupplier("Pedro P", "PEDRO HENRIQUE"), false);
  // Renan não é prefixo de RENATO.
  assert.equal(matchesSupplier("Renan", "RENATO MENEZES - BB Cc 18869"), false);
  assert.equal(matchesSupplier("Renato", null), false);
});

test("suggestCreditor: memória vence o nome", () => {
  const memory = { "FERNANDO SOTRATE FERREIRA": "c-renato" };
  assert.equal(suggestCreditor("FERNANDO SOTRATE FERREIRA", CREDITORS, memory), "c-renato");
  assert.equal(suggestCreditor("FERNANDO SOTRATE FERREIRA", CREDITORS, {}), "c-sotrate");
});

test("suggestCreditor: só ativos, ambíguo e sem fornecedor viram null", () => {
  assert.equal(suggestCreditor("RENAN SILVA", CREDITORS, {}), null);
  const twins: VbCreditorOption[] = [
    { id: "a", name: "Maria", active: true },
    { id: "b", name: "Maria Ap", active: true },
  ];
  assert.equal(suggestCreditor("MARIA APARECIDA", twins, {}), null);
  assert.equal(suggestCreditor(null, CREDITORS, {}), null);
  assert.equal(suggestCreditor("CEMIG D", CREDITORS, {}), null);
});

test("suggestKind segue o mapa por categoria e cai em saída", () => {
  assert.equal(suggestKind("2.05.03"), "saida");
  assert.equal(suggestKind("2.05.01"), "saida");
  assert.equal(suggestKind("2.10.98"), "entrada");
  assert.equal(suggestKind("2.03.98"), "saida");
  assert.equal(suggestKind(null), "saida");
});

test("isCandidateMovement: empresa, tipo e data inclusiva", () => {
  const base = { company_id: VB_OMIE_COMPANY_ID, type: "despesa", payment_date: VB_OMIE_START_DATE };
  assert.equal(isCandidateMovement(base), true);
  assert.equal(isCandidateMovement({ ...base, payment_date: "2026-09-09" }), false);
  assert.equal(isCandidateMovement({ ...base, type: "receita" }), false);
  assert.equal(isCandidateMovement({ ...base, company_id: "outra" }), false);
});

test("prefillFromMovement: data, descrição cortada, credor e tipo sugeridos, valor em string BR", () => {
  const long = "x".repeat(320);
  const result = prefillFromMovement(movement({ description: long, value: 1234.5 }), CREDITORS, {});
  assert.equal(result.date, "2026-09-12");
  assert.equal(result.description.length, 300);
  assert.deepEqual(result.lines, [{ creditorId: "c-sotrate", kind: "saida", amount: "1234,5" }]);
});

test("prefillFromMovement: sem sugestão usa o primeiro credor ativo; descrição nula vira vazia", () => {
  const result = prefillFromMovement(
    movement({ supplier_customer: "CEMIG D", description: null, category_code: "2.10.98", value: 5580.57 }),
    CREDITORS,
    {},
  );
  assert.equal(result.description, "");
  assert.deepEqual(result.lines, [{ creditorId: "c-renato", kind: "entrada", amount: "5580,57" }]);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --import tsx --test src/lib/vb/omie/suggest.test.ts`
Expected: FAIL (Cannot find module '@/lib/vb/omie/suggest').

- [ ] **Step 3: Implementar**

```ts
// src/lib/vb/omie/suggest.ts
// Sugestões da triagem da Omie. Tudo puro: nada aqui decide, só propõe — a
// decisão é sempre do gestor no diálogo.

import { numberToInput } from "@/lib/orcamento/format";
import {
  VB_OMIE_COMPANY_ID,
  VB_OMIE_KIND_BY_CATEGORY,
  VB_OMIE_START_DATE,
  VB_OMIE_TYPES,
} from "@/lib/vb/omie/config";
import type { VbCreditorOption, VbEntryKind, VbEntryPrefill, VbOmieMovement } from "@/lib/vb/types";

/** Mesmo limite da coluna/descrição do lançamento manual. */
export const VB_OMIE_DESCRIPTION_MAX = 300;

/** "MARIA APARECIDA - CONTA BRADESCO" → ["maria","aparecida","conta","bradesco"]. */
export function normalizeTokens(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/**
 * Cada token do nome do credor precisa ser prefixo de um token DISTINTO do
 * fornecedor, na ordem: "Pedro P" casa "PEDRO PAULO", não "PEDRO HENRIQUE"
 * (o "P" não pode reaproveitar PEDRO).
 */
export function matchesSupplier(creditorName: string, supplier: string | null): boolean {
  const wanted = normalizeTokens(creditorName);
  const have = normalizeTokens(supplier);
  if (wanted.length === 0 || have.length === 0) return false;
  let position = 0;
  for (const token of wanted) {
    let found = -1;
    for (let i = position; i < have.length; i++) {
      if (have[i].startsWith(token)) {
        found = i;
        break;
      }
    }
    if (found === -1) return false;
    position = found + 1;
  }
  return true;
}

/** Memória (fornecedor → credor do último vínculo) antes do nome; ambíguo → null. */
export function suggestCreditor(
  supplier: string | null,
  creditors: readonly VbCreditorOption[],
  memory: Readonly<Record<string, string>>,
): string | null {
  if (!supplier) return null;
  const remembered = memory[supplier];
  if (remembered && creditors.some((c) => c.id === remembered)) return remembered;
  const matches = creditors.filter((c) => c.active && matchesSupplier(c.name, supplier));
  return matches.length === 1 ? matches[0].id : null;
}

export function suggestKind(categoryCode: string | null): VbEntryKind {
  return (categoryCode && VB_OMIE_KIND_BY_CATEGORY[categoryCode]) || "saida";
}

/** Entra na triagem? Empresa fixa, tipo permitido e data no recorte (inclusivo). */
export function isCandidateMovement(row: { company_id: string; type: string; payment_date: string }): boolean {
  return (
    row.company_id === VB_OMIE_COMPANY_ID &&
    VB_OMIE_TYPES.includes(row.type) &&
    row.payment_date >= VB_OMIE_START_DATE
  );
}

/** Valores iniciais do diálogo: uma linha com o valor do pagamento. */
export function prefillFromMovement(
  movement: VbOmieMovement,
  creditors: readonly VbCreditorOption[],
  memory: Readonly<Record<string, string>>,
): VbEntryPrefill {
  const creditorId =
    suggestCreditor(movement.supplier_customer, creditors, memory) ??
    creditors.find((c) => c.active)?.id ??
    creditors[0]?.id ??
    "";
  return {
    date: movement.payment_date,
    description: (movement.description ?? "").trim().slice(0, VB_OMIE_DESCRIPTION_MAX),
    lines: [{ creditorId, kind: suggestKind(movement.category_code), amount: numberToInput(movement.value) }],
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --import tsx --test src/lib/vb/omie/suggest.test.ts`
Expected: 8 testes, 0 falhas.

- [ ] **Step 5: Commitar**

```bash
git add src/lib/vb/omie/suggest.ts src/lib/vb/omie/suggest.test.ts
git commit -m "feat(vb): sugestão de credor e tipo para a triagem da Omie (lógica pura)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 3: Leituras (admin client)

**Files:**
- Create: `src/lib/vb/omie/queries.ts`

**Interfaces:**
- Consumes: Task 1 (config, tipos), `isCandidateMovement` (Task 2), `createAdminClient` de `@/lib/supabase/admin`.
- Produces (todas `async`, lançam `Error` em falha de banco):
  - `listPendingMovements(): Promise<VbOmieMovement[]>` — candidatos sem decisão, mais recente primeiro.
  - `countPendingMovements(): Promise<number>`
  - `getCandidateMovement(omieId: string): Promise<VbOmieMovement | null>` — null se não existe ou não é candidato.
  - `listTriage(status: VbOmieTriageStatus): Promise<VbOmieTriageRow[]>`
  - `suggestionMemory(): Promise<Record<string, string>>` — fornecedor → credor da linha 0 do vínculo mais recente.
  - `getOmieSyncStatus(): Promise<VbOmieSyncStatus>`

Sem teste unitário (é só banco); valida por `tsc` + `lint`. O implementador **não** precisa de banco para esta task.

- [ ] **Step 1: Escrever o módulo**

```ts
// src/lib/vb/omie/queries.ts
// Leituras da triagem da Omie. Sempre pelo admin client, depois do gate de
// gestor (página) ou requireVbGestor() (actions): as policies de
// financial_entries dependem de vínculo com a empresa, que um gestor do VB não
// precisa ter. Lançam em erro de banco — a página cai no error.tsx do grupo.

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  VB_OMIE_COMPANY_ID,
  VB_OMIE_START_DATE,
  VB_OMIE_SYNC_RUNNING_WINDOW_MS,
  VB_OMIE_TYPES,
} from "@/lib/vb/omie/config";
import { isCandidateMovement } from "@/lib/vb/omie/suggest";
import type {
  VbEntryKind,
  VbOmieLinkedEntry,
  VbOmieMovement,
  VbOmieSyncStatus,
  VbOmieTriageRow,
  VbOmieTriageStatus,
} from "@/lib/vb/types";

/** Teto folgado: a ABD Holding tem uns 25 pagamentos por mês. */
const MAX_MOVEMENTS = 2000;
const MOVEMENT_COLUMNS =
  "id, omie_id, payment_date, supplier_customer, description, category_code, value, document_number";

type Admin = ReturnType<typeof createAdminClient>;

interface MovementRow {
  id: string;
  omie_id: string;
  payment_date: string;
  supplier_customer: string | null;
  description: string | null;
  category_code: string | null;
  value: number | string;
  document_number: string | null;
}

interface TriageDbRow {
  id: string;
  omie_id: string;
  status: VbOmieTriageStatus;
  group_id: string | null;
  payment_date: string;
  supplier_customer: string | null;
  description: string | null;
  category_code: string | null;
  category_name: string | null;
  value: number | string;
  decided_by: string | null;
  decided_at: string;
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((v): v is string => Boolean(v))));
}

/** Código → nome do plano de contas da ABD (omie_categories). */
async function categoryNames(admin: Admin): Promise<Map<string, string>> {
  const { data, error } = await admin
    .from("omie_categories")
    .select("code, description")
    .eq("company_id", VB_OMIE_COMPANY_ID);
  if (error) throw new Error(error.message);
  const map = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ code: string; description: string | null }>) {
    if (row.description && !map.has(row.code)) map.set(row.code, row.description);
  }
  return map;
}

function toMovement(row: MovementRow, categories: Map<string, string>): VbOmieMovement {
  return {
    id: row.id,
    omie_id: row.omie_id,
    payment_date: row.payment_date,
    supplier_customer: row.supplier_customer,
    description: row.description,
    category_code: row.category_code,
    category_name: row.category_code ? (categories.get(row.category_code) ?? null) : null,
    value: Number(row.value),
    document_number: row.document_number,
  };
}

/** Candidatos (empresa, tipo, data) que ainda não têm decisão, mais recente primeiro. */
export async function listPendingMovements(): Promise<VbOmieMovement[]> {
  const admin = createAdminClient();
  const [decided, rows, categories] = await Promise.all([
    admin.from("vb_omie_triage").select("omie_id").eq("company_id", VB_OMIE_COMPANY_ID),
    admin
      .from("financial_entries")
      .select(MOVEMENT_COLUMNS)
      .eq("company_id", VB_OMIE_COMPANY_ID)
      .in("type", [...VB_OMIE_TYPES])
      .gte("payment_date", VB_OMIE_START_DATE)
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(MAX_MOVEMENTS),
    categoryNames(admin),
  ]);
  if (decided.error) throw new Error(decided.error.message);
  if (rows.error) throw new Error(rows.error.message);
  const decidedIds = new Set(((decided.data ?? []) as Array<{ omie_id: string }>).map((r) => r.omie_id));
  return ((rows.data ?? []) as unknown as MovementRow[])
    .filter((row) => !decidedIds.has(row.omie_id))
    .map((row) => toMovement(row, categories));
}

export async function countPendingMovements(): Promise<number> {
  return (await listPendingMovements()).length;
}

/** O movimento, se existir hoje e for candidato; senão null. Usado pelas actions antes de decidir. */
export async function getCandidateMovement(omieId: string): Promise<VbOmieMovement | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("financial_entries")
    .select(`${MOVEMENT_COLUMNS}, company_id, type`)
    .eq("company_id", VB_OMIE_COMPANY_ID)
    .eq("omie_id", omieId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as unknown as MovementRow & { company_id: string; type: string };
  if (!isCandidateMovement(row)) return null;
  return toMovement(row, await categoryNames(admin));
}

/** Decisões de um status, com o que existe hoje na Omie e os lançamentos do grupo. */
export async function listTriage(status: VbOmieTriageStatus): Promise<VbOmieTriageRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("vb_omie_triage")
    .select("*")
    .eq("company_id", VB_OMIE_COMPANY_ID)
    .eq("status", status)
    .order("decided_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as TriageDbRow[];
  if (rows.length === 0) return [];

  const userIds = unique(rows.map((r) => r.decided_by));
  const groupIds = unique(rows.map((r) => r.group_id));

  const [live, users, entries] = await Promise.all([
    admin
      .from("financial_entries")
      .select("omie_id, value")
      .eq("company_id", VB_OMIE_COMPANY_ID)
      .in("omie_id", rows.map((r) => r.omie_id)),
    userIds.length > 0
      ? admin.from("users").select("id, name").in("id", userIds)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    groupIds.length > 0
      ? admin
          .from("vb_entries")
          .select("id, creditor_id, kind, amount, sort_order, group_id")
          .in("group_id", groupIds)
          .order("sort_order")
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ]);
  if (live.error) throw new Error(live.error.message);
  if (users.error) throw new Error(users.error.message);
  if (entries.error) throw new Error(entries.error.message);

  const liveValue = new Map<string, number>();
  for (const row of (live.data ?? []) as Array<{ omie_id: string; value: number | string }>) {
    liveValue.set(row.omie_id, Number(row.value));
  }
  const userName = new Map<string, string | null>();
  for (const row of (users.data ?? []) as Array<{ id: string; name: string | null }>) {
    userName.set(row.id, row.name);
  }

  type EntryRow = { id: string; creditor_id: string; kind: VbEntryKind; amount: number | string; sort_order: number; group_id: string };
  const entryRows = (entries.data ?? []) as EntryRow[];
  const creditorIds = unique(entryRows.map((e) => e.creditor_id));
  const creditorName = new Map<string, string>();
  if (creditorIds.length > 0) {
    const { data: creditors, error: creditorsError } = await admin
      .from("vb_creditors")
      .select("id, name")
      .in("id", creditorIds);
    if (creditorsError) throw new Error(creditorsError.message);
    for (const row of (creditors ?? []) as Array<{ id: string; name: string }>) creditorName.set(row.id, row.name);
  }
  const entriesByGroup = new Map<string, VbOmieLinkedEntry[]>();
  for (const e of entryRows) {
    const list = entriesByGroup.get(e.group_id) ?? [];
    list.push({
      id: e.id,
      creditor_id: e.creditor_id,
      creditor_name: creditorName.get(e.creditor_id) ?? "—",
      kind: e.kind,
      amount: Number(e.amount),
      sort_order: e.sort_order,
    });
    entriesByGroup.set(e.group_id, list);
  }

  return rows.map((row) => ({
    id: row.id,
    omie_id: row.omie_id,
    status: row.status,
    group_id: row.group_id,
    payment_date: row.payment_date,
    supplier_customer: row.supplier_customer,
    description: row.description,
    category_code: row.category_code,
    category_name: row.category_name,
    value: Number(row.value),
    decided_by_name: row.decided_by ? (userName.get(row.decided_by) ?? null) : null,
    decided_at: row.decided_at,
    live: liveValue.has(row.omie_id) ? { value: liveValue.get(row.omie_id)! } : null,
    entries: row.group_id ? (entriesByGroup.get(row.group_id) ?? []) : [],
  }));
}

/** Fornecedor → credor da primeira linha (sort_order 0) do vínculo mais recente com esse fornecedor. */
export async function suggestionMemory(): Promise<Record<string, string>> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("vb_omie_triage")
    .select("supplier_customer, group_id")
    .eq("company_id", VB_OMIE_COMPANY_ID)
    .eq("status", "vinculado")
    .not("supplier_customer", "is", null)
    .order("decided_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ supplier_customer: string; group_id: string | null }>;
  const groupIds = unique(rows.map((r) => r.group_id));
  if (groupIds.length === 0) return {};

  const { data: firsts, error: firstsError } = await admin
    .from("vb_entries")
    .select("group_id, creditor_id")
    .in("group_id", groupIds)
    .eq("sort_order", 0);
  if (firstsError) throw new Error(firstsError.message);
  const creditorByGroup = new Map<string, string>();
  for (const row of (firsts ?? []) as Array<{ group_id: string; creditor_id: string }>) {
    creditorByGroup.set(row.group_id, row.creditor_id);
  }

  const memory: Record<string, string> = {};
  for (const row of rows) {
    // Mais recente primeiro: a primeira ocorrência de cada fornecedor vence.
    if (memory[row.supplier_customer] || !row.group_id) continue;
    const creditor = creditorByGroup.get(row.group_id);
    if (creditor) memory[row.supplier_customer] = creditor;
  }
  return memory;
}

/** Último sync com sucesso e se há um em andamento (trava do botão "Buscar na Omie"). */
export async function getOmieSyncStatus(): Promise<VbOmieSyncStatus> {
  const admin = createAdminClient();
  const [latest, success] = await Promise.all([
    admin
      .from("sync_log")
      .select("status, started_at")
      .eq("company_id", VB_OMIE_COMPANY_ID)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("sync_log")
      .select("finished_at")
      .eq("company_id", VB_OMIE_COMPANY_ID)
      .eq("status", "success")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (latest.error) throw new Error(latest.error.message);
  if (success.error) throw new Error(success.error.message);
  const latestRow = latest.data as { status: string; started_at: string } | null;
  const startedAt = latestRow?.started_at ? new Date(latestRow.started_at).getTime() : 0;
  const running = latestRow?.status === "running" && Date.now() - startedAt < VB_OMIE_SYNC_RUNNING_WINDOW_MS;
  const successRow = success.data as { finished_at: string | null } | null;
  return { finishedAt: successRow?.finished_at ?? null, running };
}
```

- [ ] **Step 2: Validar e commitar**

Run: `npx tsc --noEmit && npm run lint`
Expected: sem erros. Se o `Promise.all` com `Promise.resolve({ data: [], error: null })` reclamar de tipo, troque os dois ramos por consultas separadas com `if (userIds.length > 0)` — o comportamento é o mesmo.

```bash
git add src/lib/vb/omie/queries.ts
git commit -m "feat(vb): leituras da triagem da Omie (pendentes, decisões, memória, status do sync)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 4: Server actions da triagem

**Files:**
- Create: `src/lib/vb/actions/omie.ts`

**Interfaces:**
- Consumes: `getCandidateMovement`, `getOmieSyncStatus` (Task 3); `buildEntryRows`, `newEntriesSchema` de `@/lib/vb/new-entries`; `requireVbGestor`; `runCompanySyncAsSystem` de `@/lib/omie/sync` (retorna `{ recordsImported: number, ... }` e **lança** em erro); `VB_OMIE_PATH` de `@/lib/auth/vb`.
- Produces (server actions, todas `requireVbGestor()` primeiro):
  - `discardOmieMovement(omieId: string): Promise<VbActionResult>`
  - `restoreOmieMovement(omieId: string): Promise<VbActionResult>`
  - `linkOmieMovement(input: LinkOmieInput): Promise<VbActionResult<{ ids: string[]; group_id: string }>>` com `LinkOmieInput = NewEntriesInput & { omie_id: string }`
  - `unlinkOmieMovement(omieId: string): Promise<VbActionResult<{ removed: number }>>`
  - `syncOmieNow(): Promise<VbActionResult<{ recordsImported: number }>>`

Sem teste unitário (é banco + Omie); valida por `tsc` + `lint`. A regra de compensação está nos comentários do código — não a remova.

- [ ] **Step 1: Escrever o módulo**

```ts
// src/lib/vb/actions/omie.ts
"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { VB_OMIE_PATH } from "@/lib/auth/vb";
import { runCompanySyncAsSystem } from "@/lib/omie/sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireVbGestor } from "@/lib/vb/auth";
import { buildEntryRows, newEntriesSchema } from "@/lib/vb/new-entries";
import { VB_OMIE_COMPANY_ID } from "@/lib/vb/omie/config";
import { getCandidateMovement, getOmieSyncStatus } from "@/lib/vb/omie/queries";
import type { VbActionResult, VbOmieMovement } from "@/lib/vb/types";

const UNIQUE_VIOLATION = "23505";
const ALREADY_DECIDED = "Este movimento já foi decidido.";
const NOT_FOUND = "Movimento não encontrado na Omie.";

const linkOmieSchema = newEntriesSchema.extend({ omie_id: z.string().min(1, "Movimento inválido.") });
export type LinkOmieInput = z.infer<typeof linkOmieSchema>;

function revalidateOmie(creditorIds: readonly string[] = []) {
  revalidatePath("/vb");
  revalidatePath(VB_OMIE_PATH);
  for (const id of creditorIds) revalidatePath(`/vb/credores/${id}`);
}

/** Retrato do movimento no momento da decisão (sobrevive ao sync apagar a linha). */
function snapshot(movement: VbOmieMovement) {
  return {
    company_id: VB_OMIE_COMPANY_ID,
    omie_id: movement.omie_id,
    financial_entry_id: movement.id,
    payment_date: movement.payment_date,
    supplier_customer: movement.supplier_customer,
    description: movement.description,
    category_code: movement.category_code,
    category_name: movement.category_name,
    value: movement.value,
  };
}

/** Descarta: grava a decisão com retrato. Reversível por restoreOmieMovement. */
export async function discardOmieMovement(omieId: string): Promise<VbActionResult> {
  const user = await requireVbGestor();
  const movement = await getCandidateMovement(omieId);
  if (!movement) return { error: NOT_FOUND };

  const admin = createAdminClient();
  const { error } = await admin
    .from("vb_omie_triage")
    .insert({ ...snapshot(movement), status: "descartado", group_id: null, decided_by: user.id });
  if (error) return { error: error.code === UNIQUE_VIOLATION ? ALREADY_DECIDED : error.message };

  revalidateOmie();
  return { ok: true };
}

/** Restaura um descarte: apaga a decisão; o movimento volta a pendente. */
export async function restoreOmieMovement(omieId: string): Promise<VbActionResult> {
  await requireVbGestor();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("vb_omie_triage")
    .delete()
    .eq("company_id", VB_OMIE_COMPANY_ID)
    .eq("omie_id", omieId)
    .eq("status", "descartado")
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Nenhum descarte para restaurar." };

  revalidateOmie();
  return { ok: true };
}

/**
 * Vincula: grava os lançamentos (um INSERT, group_id novo) e depois a decisão.
 * Se a decisão falhar, apaga os lançamentos do grupo — sem decisão eles não
 * podem existir. A chave única (company_id, omie_id) é a garantia contra o
 * vínculo duplo mesmo em corrida; a checagem prévia só evita gravar à toa.
 */
export async function linkOmieMovement(
  input: LinkOmieInput,
): Promise<VbActionResult<{ ids: string[]; group_id: string }>> {
  const user = await requireVbGestor();
  const parsed = linkOmieSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const { omie_id, ...entriesInput } = parsed.data;

  const movement = await getCandidateMovement(omie_id);
  if (!movement) return { error: NOT_FOUND };

  const group_id = randomUUID();
  const built = buildEntryRows(entriesInput, { userId: user.id, groupId: group_id });
  if ("error" in built) return built;

  const admin = createAdminClient();
  const creditorIds = Array.from(new Set(built.rows.map((row) => row.creditor_id)));
  const { data: creditors, error: creditorError } = await admin
    .from("vb_creditors")
    .select("id")
    .in("id", creditorIds);
  if (creditorError) return { error: creditorError.message };
  if ((creditors ?? []).length !== creditorIds.length) return { error: "Credor não encontrado." };

  const { data: existing, error: existingError } = await admin
    .from("vb_omie_triage")
    .select("id")
    .eq("company_id", VB_OMIE_COMPANY_ID)
    .eq("omie_id", omie_id)
    .maybeSingle();
  if (existingError) return { error: existingError.message };
  if (existing) return { error: ALREADY_DECIDED };

  const { data: inserted, error: insertError } = await admin.from("vb_entries").insert(built.rows).select("id");
  if (insertError || !inserted) return { error: insertError?.message ?? "Falha ao gravar os lançamentos." };

  const { error: triageError } = await admin
    .from("vb_omie_triage")
    .insert({ ...snapshot(movement), status: "vinculado", group_id, decided_by: user.id });
  if (triageError) {
    const { error: cleanupError } = await admin.from("vb_entries").delete().eq("group_id", group_id);
    if (cleanupError) {
      console.error("[vb-omie] link compensation failed", { group_id, error: cleanupError.message });
      return {
        error: `Falha ao registrar o vínculo e a limpeza também falhou (grupo ${group_id}). Avise o suporte.`,
      };
    }
    return { error: triageError.code === UNIQUE_VIOLATION ? ALREADY_DECIDED : triageError.message };
  }

  revalidateOmie(creditorIds);
  return { ok: true, ids: inserted.map((row) => row.id as string), group_id };
}

/**
 * Desvincula: apaga os lançamentos do grupo e depois a decisão. Tolera zero
 * lançamentos (reexecução depois de uma falha parcial só apaga a decisão).
 */
export async function unlinkOmieMovement(omieId: string): Promise<VbActionResult<{ removed: number }>> {
  await requireVbGestor();
  const admin = createAdminClient();
  const { data: triage, error: triageError } = await admin
    .from("vb_omie_triage")
    .select("id, group_id")
    .eq("company_id", VB_OMIE_COMPANY_ID)
    .eq("omie_id", omieId)
    .eq("status", "vinculado")
    .maybeSingle();
  if (triageError) return { error: triageError.message };
  if (!triage) return { error: "Vínculo não encontrado." };

  const groupId = triage.group_id as string | null;
  let removed = 0;
  let creditorIds: string[] = [];
  if (groupId) {
    const { data: deleted, error: deleteError } = await admin
      .from("vb_entries")
      .delete()
      .eq("group_id", groupId)
      .eq("status", "aprovado")
      .select("id, creditor_id");
    if (deleteError) return { error: deleteError.message };
    removed = deleted?.length ?? 0;
    creditorIds = Array.from(new Set((deleted ?? []).map((row) => row.creditor_id as string)));
  }

  const { error } = await admin.from("vb_omie_triage").delete().eq("id", triage.id as string);
  if (error) {
    return { error: `${error.message} (${removed} lançamento(s) já apagados; repita o desvincular)` };
  }

  revalidateOmie(creditorIds);
  return { ok: true, removed };
}

/** "Buscar na Omie": o mesmo sync rolling (3 dias) do cron, agora. */
export async function syncOmieNow(): Promise<VbActionResult<{ recordsImported: number }>> {
  await requireVbGestor();
  const status = await getOmieSyncStatus();
  if (status.running) return { error: "Sincronização em andamento. Aguarde um minuto e tente de novo." };
  try {
    const result = await runCompanySyncAsSystem(VB_OMIE_COMPANY_ID, "rolling");
    revalidateOmie();
    return { ok: true, recordsImported: result.recordsImported };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao sincronizar com a Omie." };
  }
}
```

- [ ] **Step 2: Validar e commitar**

Run: `npx tsc --noEmit && npm run lint`
Expected: sem erros. (Arquivo `"use server"` só pode exportar funções async e tipos — não exporte o schema.)

```bash
git add src/lib/vb/actions/omie.ts
git commit -m "feat(vb): actions da triagem da Omie (descartar, restaurar, vincular, desvincular, sincronizar)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 5: Diálogo de lançamento controlado, com modo Omie

**Files:**
- Modify: `src/lib/vb/new-entries.ts` (acrescentar `sumTypedLines`)
- Test: `src/lib/vb/new-entries.test.ts` (acrescentar 1 teste)
- Rewrite: `src/components/vb/new-entry-dialog.tsx`

**Interfaces:**
- Consumes: `linkOmieMovement` (Task 4), `createVbEntries` (existente), tipos `VbCreditorOption`, `VbEntryPrefill` (Task 1), `parseBrNumber`/`formatBRL` de `@/lib/orcamento/format`, `todayBR`.
- Produces:
  - `sumTypedLines(lines: ReadonlyArray<{ kind: VbEntryKind; amount: string }>): { entradas; saidas; rendimentos; liquido; bruto }` (números; `bruto` = soma dos módulos, é o que se compara com o valor da Omie).
  - `VbEntryDialog({ open, onOpenChange, creditors, initial?, omie?, onSaved? })` — controlado; com `omie` grava via `linkOmieMovement`.
  - `VbNewEntryDialog({ creditors, defaultCreditorId? })` — mesma API de hoje (botão "Novo lançamento"); as duas páginas que o usam não mudam.

- [ ] **Step 1: Teste do `sumTypedLines` (falha: função não existe)** — acrescente ao fim de `src/lib/vb/new-entries.test.ts` e inclua `sumTypedLines` no import do topo:

```ts
test("sumTypedLines soma por tipo a partir das strings digitadas e ignora inválidas", () => {
  const totals = sumTypedLines([
    { kind: "entrada", amount: "1.000,50" },
    { kind: "saida", amount: "-200" },
    { kind: "rendimento", amount: "-10,5" },
    { kind: "entrada", amount: "abc" },
    { kind: "saida", amount: "" },
  ]);
  assert.deepEqual(totals, { entradas: 1000.5, saidas: 200, rendimentos: -10.5, liquido: 790, bruto: 1211 });
});
```

Run: `node --import tsx --test src/lib/vb/new-entries.test.ts` → FAIL (sumTypedLines is not a function / not exported).

- [ ] **Step 2: Implementar em `src/lib/vb/new-entries.ts`** (import `parseBrNumber` de `@/lib/orcamento/format`; `roundCents` já está importado):

```ts
/**
 * Totais do formulário a partir do que foi digitado (strings BR). Linhas
 * inválidas são ignoradas — o submit é quem reclama delas. `bruto` (soma dos
 * módulos) é o número que se compara com o valor de um pagamento da Omie.
 */
export function sumTypedLines(
  lines: ReadonlyArray<{ kind: VbEntryKind; amount: string }>,
): { entradas: number; saidas: number; rendimentos: number; liquido: number; bruto: number } {
  let entradas = 0;
  let saidas = 0;
  let rendimentos = 0;
  let bruto = 0;
  for (const line of lines) {
    const raw = parseBrNumber(line.amount);
    if (raw == null || Number.isNaN(raw)) continue;
    bruto += Math.abs(raw);
    if (line.kind === "entrada") entradas += Math.abs(raw);
    else if (line.kind === "saida") saidas += Math.abs(raw);
    else rendimentos += raw;
  }
  return {
    entradas: roundCents(entradas),
    saidas: roundCents(saidas),
    rendimentos: roundCents(rendimentos),
    liquido: roundCents(entradas - saidas + rendimentos),
    bruto: roundCents(bruto),
  };
}
```

Acrescente `import type { VbEntryInsert, VbEntryKind } from "@/lib/vb/types";` (o arquivo hoje importa só `VbEntryInsert`).

Run: `node --import tsx --test src/lib/vb/new-entries.test.ts` → 9 testes, 0 falhas.

- [ ] **Step 3: Reescrever `src/components/vb/new-entry-dialog.tsx`** (substitui o arquivo inteiro):

```tsx
"use client";

// Diálogo de lançamento do VB: uma operação com uma ou mais linhas (credor ·
// tipo · valor) que entram juntas no extrato. Data e descrição valem para
// todas as linhas; período e taxa só para as de rendimento. Dois usos:
// - VbNewEntryDialog: botão "Novo lançamento" (Visão geral e tela do credor);
// - VbEntryDialog controlado com `omie`: a triagem abre já preenchido e grava
//   via linkOmieMovement, comparando o total com o valor do pagamento.

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Loader2, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toaster";
import { todayBR } from "@/lib/ctrl/datetime";
import { formatBRL, parseBrNumber } from "@/lib/orcamento/format";
import { createVbEntries } from "@/lib/vb/actions/entries";
import { linkOmieMovement } from "@/lib/vb/actions/omie";
import { sumTypedLines, VB_MAX_ENTRY_LINES, type NewEntriesInput, type NewEntryLine } from "@/lib/vb/new-entries";
import { VB_KIND_LABELS, type VbCreditorOption, type VbEntryKind, type VbEntryPrefill } from "@/lib/vb/types";

export type { VbCreditorOption } from "@/lib/vb/types";

const SELECT_CLS =
  "h-8 w-full rounded-md border border-border bg-surface-1 px-2 text-[13px] text-ink-primary outline-none focus:ring-2 focus:ring-teal-500/40";
const INPUT_CLS = "h-8 text-[13px]";
const LINE_GRID = "grid grid-cols-[minmax(0,1fr)_128px_136px_28px] items-center gap-2";
const KINDS = Object.keys(VB_KIND_LABELS) as VbEntryKind[];

/** A cor do valor acompanha o tipo, como no extrato. */
const AMOUNT_TONE: Record<VbEntryKind, string> = {
  entrada: "text-emerald-700",
  saida: "text-red-600",
  rendimento: "text-sky-700",
};

interface Line {
  key: number;
  creditorId: string;
  kind: VbEntryKind;
  amount: string;
}

export interface VbEntryDialogOmie {
  omieId: string;
  /** Valor do pagamento na Omie, para o aviso de total diferente. */
  value: number;
}

export interface VbEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  creditors: VbCreditorOption[];
  /** Valores iniciais; sem isso: hoje, descrição vazia, uma linha com o primeiro credor ativo. */
  initial?: VbEntryPrefill;
  /** Modo vínculo com um pagamento da Omie. */
  omie?: VbEntryDialogOmie;
  onSaved?: (result: { ids: string[]; group_id: string }) => void;
}

/** Diálogo controlado. O formulário desmonta ao fechar, então o estado zera sozinho. */
export function VbEntryDialog({ open, onOpenChange, creditors, initial, omie, onSaved }: VbEntryDialogProps) {
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <DialogContent className="sm:max-w-2xl">
        <EntryForm
          creditors={creditors}
          initial={initial}
          omie={omie}
          onSaved={onSaved}
          onClose={() => onOpenChange(false)}
          onPendingChange={setPending}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Botão "Novo lançamento" (Visão geral e tela do credor). */
export function VbNewEntryDialog({ creditors, defaultCreditorId }: { creditors: VbCreditorOption[]; defaultCreditorId?: string }) {
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<VbEntryPrefill | undefined>(undefined);
  function openDialog() {
    setInitial(
      defaultCreditorId
        ? { date: todayBR(), description: "", lines: [{ creditorId: defaultCreditorId, kind: "entrada", amount: "" }] }
        : undefined,
    );
    setOpen(true);
  }
  return (
    <>
      <Button type="button" onClick={openDialog}>
        <Plus className="mr-2 h-4 w-4" /> Novo lançamento
      </Button>
      <VbEntryDialog open={open} onOpenChange={setOpen} creditors={creditors} initial={initial} />
    </>
  );
}

function EntryForm({
  creditors,
  initial,
  omie,
  onSaved,
  onClose,
  onPendingChange,
}: {
  creditors: VbCreditorOption[];
  initial?: VbEntryPrefill;
  omie?: VbEntryDialogOmie;
  onSaved?: (result: { ids: string[]; group_id: string }) => void;
  onClose: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  useEffect(() => onPendingChange(pending), [pending, onPendingChange]);

  const options = useMemo(
    () => [...creditors].sort((a, b) => Number(b.active) - Number(a.active)),
    [creditors],
  );
  const fallbackCreditorId = options[0]?.id ?? "";

  const [date, setDate] = useState(() => initial?.date ?? todayBR());
  const [description, setDescription] = useState(() => initial?.description ?? "");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [ratePct, setRatePct] = useState("");
  const [basis, setBasis] = useState<"periodo" | "ajuste">("periodo");
  const nextKey = useRef(0);
  const [lines, setLines] = useState<Line[]>(() => {
    const seed =
      initial && initial.lines.length > 0
        ? initial.lines
        : [{ creditorId: fallbackCreditorId, kind: "entrada" as VbEntryKind, amount: "" }];
    return seed.map((line) => ({ key: nextKey.current++, ...line }));
  });

  const hasYield = lines.some((line) => line.kind === "rendimento");
  const totals = useMemo(() => sumTypedLines(lines), [lines]);
  const omieDiffers = omie ? Math.abs(totals.bruto - omie.value) >= 0.01 : false;

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function removeLine(key: number) {
    setLines((current) => (current.length > 1 ? current.filter((line) => line.key !== key) : current));
  }

  /** Linha nova: mesmo tipo da última e o próximo credor ativo ainda não usado. */
  function addLine() {
    setLines((current) => {
      if (current.length >= VB_MAX_ENTRY_LINES) return current;
      const used = new Set(current.map((line) => line.creditorId));
      const next = options.find((c) => c.active && !used.has(c.id)) ?? options[0];
      const last = current[current.length - 1];
      return [...current, { key: nextKey.current++, creditorId: next?.id ?? "", kind: last?.kind ?? "entrada", amount: "" }];
    });
  }

  /** "Juros do mês para todos": uma linha para cada credor ativo que ainda não está na lista. */
  function addAllActive() {
    setLines((current) => {
      const used = new Set(current.map((line) => line.creditorId));
      const last = current[current.length - 1];
      const missing = options.filter((c) => c.active && !used.has(c.id));
      const room = Math.max(VB_MAX_ENTRY_LINES - current.length, 0);
      return [
        ...current,
        ...missing.slice(0, room).map((c) => ({
          key: nextKey.current++,
          creditorId: c.id,
          kind: last?.kind ?? ("entrada" as VbEntryKind),
          amount: "",
        })),
      ];
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsedLines: NewEntryLine[] = [];
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!line.creditorId) {
        showToast({ title: `Linha ${index + 1}: escolha o credor`, variant: "destructive" });
        return;
      }
      const raw = parseBrNumber(line.amount);
      if (raw == null || Number.isNaN(raw)) {
        showToast({ title: `Linha ${index + 1}: valor inválido`, variant: "destructive" });
        return;
      }
      parsedLines.push({ creditor_id: line.creditorId, kind: line.kind, amount: raw });
    }
    const rate = hasYield && ratePct.trim() ? parseBrNumber(ratePct) : null;
    if (rate != null && Number.isNaN(rate)) {
      showToast({ title: "Taxa inválida", variant: "destructive" });
      return;
    }
    const payload: NewEntriesInput = {
      entry_date: date,
      description: description.trim() || null,
      period_start: hasYield && periodStart ? periodStart : null,
      period_end: hasYield ? periodEnd || date : null,
      rate: hasYield && rate != null ? rate / 100 : null,
      rate_basis: hasYield ? (rate != null ? basis : "ajuste") : null,
      lines: parsedLines,
    };
    startTransition(async () => {
      const result = omie
        ? await linkOmieMovement({ ...payload, omie_id: omie.omieId })
        : await createVbEntries(payload);
      if ("error" in result) {
        showToast({ title: "Não gravado", description: result.error, variant: "destructive" });
        return;
      }
      const n = result.ids.length;
      showToast({
        title: omie
          ? n === 1 ? "Vinculado ao VB" : `Vinculado: ${n} lançamentos`
          : n === 1 ? "Lançamento gravado" : `${n} lançamentos gravados`,
        variant: "success",
      });
      onSaved?.(result);
      onClose();
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{omie ? "Vincular pagamento ao VB" : "Novo lançamento"}</DialogTitle>
        <DialogDescription>
          Uma linha por credor. Tudo entra junto no extrato, na mesma data; transferência entre credores
          fecha o líquido em zero.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-[168px_minmax(0,1fr)]">
        <div>
          <Label htmlFor="vb-new-date">Data</Label>
          <Input id="vb-new-date" type="date" className={INPUT_CLS} value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="vb-new-desc">Descrição</Label>
          <Input
            id="vb-new-desc"
            className={INPUT_CLS}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={300}
            placeholder="Vale para todas as linhas"
          />
        </div>
      </div>

      {hasYield && (
        <div className="grid gap-3 rounded-md border border-sky-500/30 bg-sky-500/5 p-3 sm:grid-cols-4">
          <p className="text-[12px] text-sky-700 sm:col-span-4">
            Período e taxa valem para todas as linhas de rendimento. Sem taxa, o valor entra como ajuste.
          </p>
          <div>
            <Label htmlFor="vb-new-ps">Início do período</Label>
            <Input id="vb-new-ps" type="date" className={INPUT_CLS} value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="vb-new-pe">Fim do período</Label>
            <Input id="vb-new-pe" type="date" className={INPUT_CLS} value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} placeholder={date} />
          </div>
          <div>
            <Label htmlFor="vb-new-rate">Taxa no período (%)</Label>
            <Input id="vb-new-rate" inputMode="decimal" className={INPUT_CLS} value={ratePct} onChange={(e) => setRatePct(e.target.value)} placeholder="3,35" />
          </div>
          <div>
            <Label htmlFor="vb-new-basis">Método</Label>
            <select
              id="vb-new-basis"
              className={SELECT_CLS}
              value={ratePct.trim() ? basis : "ajuste"}
              onChange={(e) => setBasis(e.target.value as "periodo" | "ajuste")}
              disabled={!ratePct.trim()}
            >
              <option value="periodo">Saldo × taxa do período</option>
              <option value="ajuste">Ajuste manual</option>
            </select>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <div className="min-w-[520px] space-y-1.5">
          <div className={`${LINE_GRID} px-1 text-[11px] font-medium uppercase tracking-wide text-ink-muted`}>
            <span>Credor</span>
            <span>Tipo</span>
            <span className="text-right">Valor (R$)</span>
            <span />
          </div>
          {lines.map((line, index) => (
            <div key={line.key} className={LINE_GRID}>
              <select
                aria-label={`Credor da linha ${index + 1}`}
                className={SELECT_CLS}
                value={line.creditorId}
                onChange={(e) => updateLine(line.key, { creditorId: e.target.value })}
                required
              >
                {!line.creditorId && <option value="">Escolha o credor</option>}
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.active ? c.name : `${c.name} (encerrado)`}
                  </option>
                ))}
              </select>
              <select
                aria-label={`Tipo da linha ${index + 1}`}
                className={SELECT_CLS}
                value={line.kind}
                onChange={(e) => updateLine(line.key, { kind: e.target.value as VbEntryKind })}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {VB_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
              <Input
                aria-label={`Valor da linha ${index + 1}`}
                inputMode="decimal"
                className={`${INPUT_CLS} text-right font-medium tabular-nums ${AMOUNT_TONE[line.kind]}`}
                value={line.amount}
                onChange={(e) => updateLine(line.key, { amount: e.target.value })}
                placeholder="1.000,00"
                required
              />
              <button
                type="button"
                aria-label={`Remover linha ${index + 1}`}
                onClick={() => removeLine(line.key)}
                disabled={lines.length === 1 || pending}
                className="inline-flex h-7 w-7 items-center justify-center rounded text-ink-muted hover:bg-surface-2 hover:text-red-600 disabled:opacity-30"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-4 pt-1">
            <button
              type="button"
              onClick={addLine}
              disabled={pending || lines.length >= VB_MAX_ENTRY_LINES}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-teal-700 hover:underline disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Adicionar linha
            </button>
            <button
              type="button"
              onClick={addAllActive}
              disabled={pending || lines.length >= VB_MAX_ENTRY_LINES}
              className="text-[12px] text-ink-muted hover:underline disabled:opacity-50"
            >
              Todos os credores ativos
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-[12px] tabular-nums">
        <span className="text-emerald-700">Entradas {formatBRL(totals.entradas)}</span>
        <span className="text-red-600">Saídas {formatBRL(totals.saidas)}</span>
        <span className="text-sky-700">Rendimentos {formatBRL(totals.rendimentos)}</span>
        <span className={`ml-auto font-medium ${totals.liquido < 0 ? "text-red-600" : "text-ink-primary"}`}>
          Líquido {formatBRL(totals.liquido)}
        </span>
        {omie && (
          <span className={`basis-full ${omieDiffers ? "text-amber-700" : "text-ink-muted"}`}>
            Omie: {formatBRL(omie.value)}
            {omieDiffers && ` · o total das linhas (${formatBRL(totals.bruto)}) é diferente do pagamento`}
          </span>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {omie ? "Vincular" : lines.length > 1 ? `Gravar ${lines.length} lançamentos` : "Gravar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
```

- [ ] **Step 4: Validar e commitar**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: sem erros; 62 testes passando (53 atuais + 8 da Task 2 + 1 desta).

```bash
git add src/lib/vb/new-entries.ts src/lib/vb/new-entries.test.ts src/components/vb/new-entry-dialog.tsx
git commit -m "feat(vb): diálogo de lançamento controlado, com modo de vínculo à Omie

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 6: Tela `/vb/omie` — tabela de pendentes, container e página

**Files:**
- Create: `src/components/vb/omie-pending-table.tsx`
- Test: `src/components/vb/omie-pending-table.test.tsx`
- Create: `src/components/vb/omie-triage.tsx`
- Create: `src/app/(vb)/vb/omie/page.tsx`

**Interfaces:**
- Consumes: queries (Task 3), actions (Task 4), `VbEntryDialog` (Task 5), `prefillFromMovement`/`suggestCreditor`/`suggestKind` (Task 2), `listCreditors` de `@/lib/vb/queries` (recebe um client; use o admin), `getVbUser`, `formatDayBR`/`formatDateTimeBR`, `formatBRL`, `VB_OMIE_COMPANY_NAME`/`VB_OMIE_START_DATE`.
- Produces: `OmiePendingTable` (puro, sem Radix), `VbOmieTriage` (client), página `/vb/omie` (aba via `?aba=`).

- [ ] **Step 1: Teste de render da tabela de pendentes (falha: componente não existe)**

```tsx
// src/components/vb/omie-pending-table.test.tsx
import assert from "node:assert/strict";
import { test } from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OmiePendingTable } from "@/components/vb/omie-pending-table";
import type { VbOmieMovement } from "@/lib/vb/types";

function movement(
  omie_id: string,
  payment_date: string,
  supplier_customer: string,
  description: string,
  value: number,
  category_name: string,
): VbOmieMovement {
  return {
    id: `fe-${omie_id}`,
    omie_id,
    payment_date,
    supplier_customer,
    description,
    category_code: "2.05.03",
    category_name,
    value,
    document_number: null,
  };
}

const ROWS = [
  movement("m-new", "2026-09-12", "FERNANDO SOTRATE FERREIRA", "RESGATE VB", 330000, "Pagamento de Empréstimos"),
  movement("m-old", "2026-09-10", "VILLAGE EMPREENDIMENTOS", "APORTE EMPRESA", 30000, "Aumento de capital em controlada"),
];

test("mantém a ordem recebida (mais recente primeiro) e mostra categoria, sugestão e ações", () => {
  const html = renderToStaticMarkup(
    <OmiePendingTable
      rows={ROWS}
      suggestions={{ "m-new": { creditorName: "Sotrate", kind: "saida" }, "m-old": null }}
      onLink={() => {}}
      onDiscard={() => {}}
      emptyText="vazio"
    />,
  );
  assert.ok(html.indexOf("RESGATE VB") < html.indexOf("APORTE EMPRESA"));
  assert.ok(html.includes("Pagamento de Empréstimos"));
  assert.ok(html.includes("Sotrate"));
  assert.ok(html.includes("Saída"));
  assert.ok(html.includes("Vincular"));
  assert.ok(html.includes("Descartar"));
  assert.ok(!/planilha/i.test(html));
});

test("lista vazia mostra o texto de vazio", () => {
  const html = renderToStaticMarkup(
    <OmiePendingTable rows={[]} suggestions={{}} onLink={() => {}} onDiscard={() => {}} emptyText="Nenhum pagamento aguardando." />,
  );
  assert.ok(html.includes("Nenhum pagamento aguardando."));
});
```

Run: `node --import tsx --test src/components/vb/omie-pending-table.test.tsx` → FAIL (Cannot find module).

- [ ] **Step 2: Tabela de pendentes** (sem Radix, para o teste de SSR; a cor do valor é vermelha porque é saída de caixa)

```tsx
// src/components/vb/omie-pending-table.tsx
"use client";

import { formatDayBR } from "@/lib/ctrl/datetime";
import { formatBRL } from "@/lib/orcamento/format";
import { VB_KIND_LABELS, type VbEntryKind, type VbOmieMovement } from "@/lib/vb/types";

export interface OmieSuggestion {
  creditorName: string;
  kind: VbEntryKind;
}

export interface OmiePendingTableProps {
  /** Já na ordem de exibição (mais recente primeiro). */
  rows: VbOmieMovement[];
  /** Por omie_id; ausente ou null = sem sugestão. */
  suggestions: Readonly<Record<string, OmieSuggestion | null>>;
  onLink: (row: VbOmieMovement) => void;
  onDiscard: (row: VbOmieMovement) => void;
  busy?: boolean;
  emptyText: string;
}

const KIND_TONE: Record<VbEntryKind, string> = {
  entrada: "text-emerald-700",
  saida: "text-red-600",
  rendimento: "text-sky-700",
};

const TH = "py-1.5 pr-3 font-medium";

export function OmiePendingTable({ rows, suggestions, onLink, onDiscard, busy, emptyText }: OmiePendingTableProps) {
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-ink-muted">{emptyText}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-ink-muted">
            <th className={TH}>Data</th>
            <th className={TH}>Fornecedor</th>
            <th className={TH}>Descrição</th>
            <th className={TH}>Categoria</th>
            <th className={`${TH} text-right`}>Valor</th>
            <th className={TH}>Sugestão</th>
            <th className="py-1.5 font-medium">
              <span className="sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const suggestion = suggestions[row.omie_id] ?? null;
            return (
              <tr key={row.omie_id} className="border-b border-border/60 hover:bg-surface-2/60">
                <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">{formatDayBR(row.payment_date)}</td>
                <td className="max-w-[220px] truncate py-1.5 pr-3 font-medium text-ink-primary" title={row.supplier_customer ?? undefined}>
                  {row.supplier_customer ?? "—"}
                </td>
                <td className="max-w-[320px] truncate py-1.5 pr-3 text-ink-secondary" title={row.description ?? undefined}>
                  {row.description ?? "—"}
                </td>
                <td className="whitespace-nowrap py-1.5 pr-3 text-ink-muted">{row.category_name ?? row.category_code ?? "—"}</td>
                <td className="whitespace-nowrap py-1.5 pr-3 text-right font-medium tabular-nums text-red-600">{formatBRL(row.value)}</td>
                <td className="whitespace-nowrap py-1.5 pr-3">
                  {suggestion ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-1 px-2 py-0.5 text-[12px]">
                      <span className="text-ink-primary">{suggestion.creditorName}</span>
                      <span className="text-ink-muted">·</span>
                      <span className={KIND_TONE[suggestion.kind]}>{VB_KIND_LABELS[suggestion.kind]}</span>
                    </span>
                  ) : (
                    <span className="text-ink-muted">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => onLink(row)}
                    disabled={busy}
                    className="rounded px-2 py-0.5 text-[12px] font-medium text-teal-700 hover:bg-teal-500/10 disabled:opacity-50"
                  >
                    Vincular
                  </button>
                  <button
                    type="button"
                    onClick={() => onDiscard(row)}
                    disabled={busy}
                    className="ml-1 rounded px-2 py-0.5 text-[12px] text-ink-muted hover:bg-surface-2 hover:text-red-600 disabled:opacity-50"
                  >
                    Descartar
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

Run: `node --import tsx --test src/components/vb/omie-pending-table.test.tsx` → 2 testes, 0 falhas.

- [ ] **Step 3: Container client da triagem**

```tsx
// src/components/vb/omie-triage.tsx
"use client";

// Triagem dos pagamentos da Omie: abas, filtros, ações e o diálogo de vínculo.
// Os dados chegam prontos do server component; toda ação chama uma server
// action e dá router.refresh(). Sugestões são calculadas aqui (lógica pura).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { VbEntryDialog } from "@/components/vb/new-entry-dialog";
import { OmiePendingTable, type OmieSuggestion } from "@/components/vb/omie-pending-table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toaster";
import { formatDateTimeBR, formatDayBR } from "@/lib/ctrl/datetime";
import { formatBRL } from "@/lib/orcamento/format";
import {
  discardOmieMovement,
  restoreOmieMovement,
  syncOmieNow,
  unlinkOmieMovement,
} from "@/lib/vb/actions/omie";
import { prefillFromMovement, suggestCreditor, suggestKind } from "@/lib/vb/omie/suggest";
import {
  VB_KIND_LABELS,
  type VbActionResult,
  type VbCreditorOption,
  type VbEntryKind,
  type VbEntryPrefill,
  type VbOmieMovement,
  type VbOmieSyncStatus,
  type VbOmieTriageRow,
} from "@/lib/vb/types";

export type OmieTab = "pendentes" | "vinculados" | "descartados";

const TABS: Array<{ id: OmieTab; label: string }> = [
  { id: "pendentes", label: "Pendentes" },
  { id: "vinculados", label: "Vinculados" },
  { id: "descartados", label: "Descartados" },
];

const ALL = "todas";
const NO_CATEGORY = "Sem categoria";

const KIND_TONE: Record<VbEntryKind, string> = {
  entrada: "text-emerald-700",
  saida: "text-red-600",
  rendimento: "text-sky-700",
};

const ACTION_CLS = "rounded px-2 py-0.5 text-[12px] font-medium hover:bg-surface-2 disabled:opacity-50";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function categoryOf(row: { category_name: string | null; category_code: string | null }): string {
  return row.category_name ?? row.category_code ?? NO_CATEGORY;
}

interface Props {
  tab: OmieTab;
  pending: VbOmieMovement[];
  linked: VbOmieTriageRow[];
  discarded: VbOmieTriageRow[];
  creditors: VbCreditorOption[];
  /** Fornecedor → credor (último vínculo). */
  memory: Readonly<Record<string, string>>;
  sync: VbOmieSyncStatus;
}

export function VbOmieTriage({ tab, pending, linked, discarded, creditors, memory, sync }: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, startTransition] = useTransition();
  const [syncing, startSync] = useTransition();
  const [category, setCategory] = useState(ALL);
  const [query, setQuery] = useState("");
  const [linking, setLinking] = useState<{ movement: VbOmieMovement; prefill: VbEntryPrefill } | null>(null);
  const [unlinking, setUnlinking] = useState<VbOmieTriageRow | null>(null);

  const creditorName = useMemo(() => new Map(creditors.map((c) => [c.id, c.name] as const)), [creditors]);

  const suggestions = useMemo(() => {
    const out: Record<string, OmieSuggestion | null> = {};
    for (const row of pending) {
      const id = suggestCreditor(row.supplier_customer, creditors, memory);
      out[row.omie_id] = id ? { creditorName: creditorName.get(id) ?? "—", kind: suggestKind(row.category_code) } : null;
    }
    return out;
  }, [pending, creditors, memory, creditorName]);

  /** Categorias presentes nos pendentes, mais frequentes primeiro. */
  const categories = useMemo(() => {
    const seen = new Map<string, number>();
    for (const row of pending) {
      const key = categoryOf(row);
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return Array.from(seen.entries()).sort((a, b) => b[1] - a[1]);
  }, [pending]);

  const filtered = useMemo(() => {
    const term = normalize(query.trim());
    return pending.filter((row) => {
      if (category !== ALL && categoryOf(row) !== category) return false;
      if (term && !normalize(`${row.supplier_customer ?? ""} ${row.description ?? ""}`).includes(term)) return false;
      return true;
    });
  }, [pending, category, query]);

  function run(action: () => Promise<VbActionResult<object>>, success: string) {
    startTransition(async () => {
      const result = await action();
      if ("error" in result) {
        showToast({ title: "Não foi possível", description: result.error, variant: "destructive" });
        return;
      }
      showToast({ title: success, variant: "success" });
      router.refresh();
    });
  }

  function runSync() {
    startSync(async () => {
      const result = await syncOmieNow();
      if ("error" in result) {
        showToast({ title: "Omie não respondeu", description: result.error, variant: "destructive" });
        return;
      }
      showToast({ title: `Omie consultada: ${result.recordsImported} movimento(s) na janela`, variant: "success" });
      router.refresh();
    });
  }

  const counts: Record<OmieTab, number> = {
    pendentes: pending.length,
    vinculados: linked.length,
    descartados: discarded.length,
  };

  const syncLabel = sync.running
    ? "Omie sincronizando…"
    : sync.finishedAt
      ? `Omie atualizada em ${formatDateTimeBR(sync.finishedAt)}`
      : "Omie ainda não sincronizada";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Abas da triagem" className="flex gap-1 rounded-md border border-border bg-surface-1 p-0.5">
          {TABS.map((t) => (
            <Link
              key={t.id}
              href={`/vb/omie?aba=${t.id}`}
              aria-current={tab === t.id ? "page" : undefined}
              className={`rounded px-3 py-1 text-[13px] ${
                tab === t.id ? "bg-surface-2 font-medium text-ink-primary" : "text-ink-muted hover:text-ink-primary"
              }`}
            >
              {t.label} <span className="tabular-nums text-ink-muted">{counts[t.id]}</span>
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-[12px] text-ink-muted">
          <span>{syncLabel}</span>
          <Button type="button" variant="outline" onClick={runSync} disabled={syncing || sync.running}>
            {syncing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
            Buscar na Omie
          </Button>
        </div>
      </div>

      {tab === "pendentes" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={category === ALL}
              onClick={() => setCategory(ALL)}
              className={`rounded-full border px-2.5 py-0.5 text-[12px] ${
                category === ALL ? "border-teal-600 bg-surface-1 text-teal-700" : "border-border text-ink-muted"
              }`}
            >
              Todas
            </button>
            {categories.map(([name, n]) => (
              <button
                key={name}
                type="button"
                aria-pressed={category === name}
                onClick={() => setCategory(category === name ? ALL : name)}
                className={`rounded-full border px-2.5 py-0.5 text-[12px] ${
                  category === name ? "border-teal-600 bg-surface-1 text-teal-700" : "border-border text-ink-muted"
                }`}
              >
                {name} <span className="tabular-nums">{n}</span>
              </button>
            ))}
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar fornecedor ou descrição"
              aria-label="Buscar fornecedor ou descrição"
              className="h-8 w-[240px] text-[13px]"
            />
            <span className="ml-auto text-[12px] text-ink-muted">
              {filtered.length} pagamento{filtered.length === 1 ? "" : "s"}
            </span>
          </div>
          <OmiePendingTable
            rows={filtered}
            suggestions={suggestions}
            busy={busy}
            onLink={(row) => setLinking({ movement: row, prefill: prefillFromMovement(row, creditors, memory) })}
            onDiscard={(row) => run(() => discardOmieMovement(row.omie_id), "Descartado")}
            emptyText={
              pending.length === 0
                ? "Nenhum pagamento aguardando. O sync diário traz os novos; \"Buscar na Omie\" traz agora."
                : "Nenhum pagamento neste recorte."
            }
          />
        </>
      )}

      {tab === "vinculados" && (
        <DecisionTable rows={linked} kind="vinculado" busy={busy} onAction={(row) => setUnlinking(row)} />
      )}
      {tab === "descartados" && (
        <DecisionTable
          rows={discarded}
          kind="descartado"
          busy={busy}
          onAction={(row) => run(() => restoreOmieMovement(row.omie_id), "Restaurado")}
        />
      )}

      <VbEntryDialog
        open={linking !== null}
        onOpenChange={(open) => !open && setLinking(null)}
        creditors={creditors}
        initial={linking?.prefill}
        omie={linking ? { omieId: linking.movement.omie_id, value: linking.movement.value } : undefined}
      />

      <Dialog open={unlinking !== null} onOpenChange={(open) => !open && setUnlinking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desvincular do VB?</DialogTitle>
            <DialogDescription>
              Apaga {unlinking?.entries.length ?? 0} lançamento(s) do VB e devolve o pagamento de{" "}
              {formatBRL(unlinking?.value ?? null)} para pendentes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setUnlinking(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                const row = unlinking;
                if (!row) return;
                setUnlinking(null);
                run(() => unlinkOmieMovement(row.omie_id), "Desvinculado");
              }}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Desvincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DecisionTable({
  rows,
  kind,
  busy,
  onAction,
}: {
  rows: VbOmieTriageRow[];
  kind: "vinculado" | "descartado";
  busy: boolean;
  onAction: (row: VbOmieTriageRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-ink-muted">
        {kind === "vinculado" ? "Nenhum pagamento vinculado ainda." : "Nenhum pagamento descartado."}
      </p>
    );
  }
  const th = "py-1.5 pr-3 font-medium";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-ink-muted">
            <th className={th}>Data</th>
            <th className={th}>Fornecedor</th>
            <th className={th}>Descrição</th>
            {kind === "descartado" && <th className={th}>Categoria</th>}
            <th className={`${th} text-right`}>{kind === "vinculado" ? "Valor Omie" : "Valor"}</th>
            {kind === "vinculado" && <th className={th}>Lançado no VB</th>}
            <th className={th}>Por</th>
            <th className="py-1.5 font-medium">
              <span className="sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const warnings: string[] = [];
            if (!row.live) warnings.push("não consta mais na Omie");
            else if (Math.abs(row.live.value - row.value) >= 0.01) warnings.push(`valor na Omie agora é ${formatBRL(row.live.value)}`);
            return (
              <tr key={row.id} className="border-b border-border/60 align-top hover:bg-surface-2/60">
                <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">{formatDayBR(row.payment_date)}</td>
                <td className="max-w-[220px] truncate py-1.5 pr-3 font-medium text-ink-primary" title={row.supplier_customer ?? undefined}>
                  {row.supplier_customer ?? "—"}
                </td>
                <td className="max-w-[300px] py-1.5 pr-3 text-ink-secondary">
                  <div className="truncate" title={row.description ?? undefined}>{row.description ?? "—"}</div>
                  {warnings.length > 0 && <div className="text-[11px] text-amber-700">{warnings.join(" · ")}</div>}
                </td>
                {kind === "descartado" && (
                  <td className="whitespace-nowrap py-1.5 pr-3 text-ink-muted">{categoryOf(row)}</td>
                )}
                <td className="whitespace-nowrap py-1.5 pr-3 text-right font-medium tabular-nums text-red-600">{formatBRL(row.value)}</td>
                {kind === "vinculado" && (
                  <td className="whitespace-nowrap py-1.5 pr-3">
                    {row.entries.length === 0 ? (
                      <span className="text-amber-700">sem lançamentos</span>
                    ) : (
                      row.entries.map((e) => (
                        <div key={e.id} className="tabular-nums">
                          <span className="text-ink-primary">{e.creditor_name}</span>{" "}
                          <span className={KIND_TONE[e.kind]}>
                            {VB_KIND_LABELS[e.kind]} {formatBRL(Math.abs(e.amount))}
                          </span>
                        </div>
                      ))
                    )}
                  </td>
                )}
                <td className="whitespace-nowrap py-1.5 pr-3 text-ink-muted">
                  {row.decided_by_name ?? "—"} · {formatDateTimeBR(row.decided_at)}
                </td>
                <td className="whitespace-nowrap py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => onAction(row)}
                    disabled={busy}
                    className={`${ACTION_CLS} ${kind === "vinculado" ? "text-ink-muted hover:text-red-600" : "text-teal-700"}`}
                  >
                    {kind === "vinculado" ? "Desvincular" : "Restaurar"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Página**

```tsx
// src/app/(vb)/vb/omie/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { VbOmieTriage, type OmieTab } from "@/components/vb/omie-triage";
import { formatDayBR } from "@/lib/ctrl/datetime";
import { createAdminClient } from "@/lib/supabase/admin";
import { getVbUser } from "@/lib/vb/auth";
import { VB_OMIE_COMPANY_NAME, VB_OMIE_START_DATE } from "@/lib/vb/omie/config";
import { getOmieSyncStatus, listPendingMovements, listTriage, suggestionMemory } from "@/lib/vb/omie/queries";
import { listCreditors } from "@/lib/vb/queries";

export const dynamic = "force-dynamic";

const TABS: readonly OmieTab[] = ["pendentes", "vinculados", "descartados"];

export default async function VbOmiePage({ searchParams }: { searchParams: { aba?: string } }) {
  const user = await getVbUser();
  if (!user) redirect("/");
  if (user.role !== "gestor") redirect("/vb");
  const tab: OmieTab = TABS.includes(searchParams.aba as OmieTab) ? (searchParams.aba as OmieTab) : "pendentes";

  // Admin client de propósito (ver queries.ts): o gestor do VB não precisa ter vínculo com a ABD.
  const admin = createAdminClient();
  const [pending, linked, discarded, creditors, memory, sync] = await Promise.all([
    listPendingMovements(),
    listTriage("vinculado"),
    listTriage("descartado"),
    listCreditors(admin),
    suggestionMemory(),
    getOmieSyncStatus(),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link href="/vb" className="inline-flex items-center gap-1 text-xs text-ink-muted hover:underline">
          <ArrowLeft className="h-3 w-3" /> Visão geral
        </Link>
        <h1 className="text-xl font-semibold text-ink-primary">Omie · {VB_OMIE_COMPANY_NAME}</h1>
        <span className="text-[11px] text-ink-muted">
          Pagamentos desde {formatDayBR(VB_OMIE_START_DATE)}. Descarte o que não é do VB; vincule o que é.
        </span>
      </div>
      <VbOmieTriage
        tab={tab}
        pending={pending}
        linked={linked}
        discarded={discarded}
        creditors={creditors.map(({ id, name, active }) => ({ id, name, active }))}
        memory={memory}
        sync={sync}
      />
    </div>
  );
}
```

- [ ] **Step 5: Validar e commitar**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: sem erros; 64 testes passando. Sem `npm run build`.

```bash
git add src/components/vb/omie-pending-table.tsx src/components/vb/omie-pending-table.test.tsx src/components/vb/omie-triage.tsx 'src/app/(vb)/vb/omie/page.tsx'
git commit -m "feat(vb): tela /vb/omie — triagem dos pagamentos da ABD Holding

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 7: Menu com contador, faixa na Visão geral e documentação

**Files:**
- Modify: `src/components/app/navigation.ts` (import de ícones no topo; grupo `vb` ~linha 339)
- Modify: `src/components/app/nav-links.tsx` (`NavLinksProps`, destructuring de `NavLinks`, `BuildInput`, `buildGroups`)
- Modify: `src/components/app/app-shell.tsx` (`AppShellProps`, destructuring, `sidebarNav`)
- Modify: `src/app/(vb)/vb/layout.tsx`
- Modify: `src/app/(vb)/vb/page.tsx`
- Modify: `CLAUDE.md` (seção "### Módulo VB")

**Interfaces:**
- Consumes: `VB_NAV_KEY_OMIE`, `VB_OMIE_PATH` (Task 1), `countPendingMovements` (Task 3).
- Produces: prop `navBadges?: Readonly<Record<string, number>>` em `AppShell` e `NavLinks` (chave = `NavItem.key`); item "Omie" no grupo VB.

- [ ] **Step 1: Item no menu** — em `src/components/app/navigation.ts`: acrescente `Inbox` à lista importada de `lucide-react`; troque o import de `@/lib/auth/vb` por `import { VB_NAV_KEY_OMIE, VB_NAV_KEY_OVERVIEW, VB_OMIE_PATH, VB_PATH } from "@/lib/auth/vb";`; no grupo `vb`, substitua o comentário "Só 'Visão geral'…" e o array `items` por:

```ts
    // "Visão geral" para todo papel; "Omie" (triagem dos pagamentos da ABD
    // Holding) só para gestor. A importação da planilha é uma vez só e não
    // tem item — quem precisa chega por ela pela Visão geral.
    id: "vb",
    label: "VB",
    items: [
      { key: VB_NAV_KEY_OVERVIEW, title: "Visão geral", icon: Landmark, scope: "global", href: VB_PATH, vbAccess: true },
      { key: VB_NAV_KEY_OMIE, title: "Omie", icon: Inbox, scope: "global", href: VB_OMIE_PATH, vbAccess: true, vbGestorOnly: true },
    ],
```

- [ ] **Step 2: Badge no menu** — em `src/components/app/nav-links.tsx`:
  1. Em `NavLinksProps`, depois de `ctrlFullView?: boolean;`, acrescente:
     ```ts
     /** Contadores por chave de item (ex.: pendentes da triagem da Omie). Só aparece quando > 0. */
     navBadges?: Readonly<Record<string, number>>;
     ```
  2. Em `NavLinks`, acrescente `navBadges,` ao destructuring e passe `navBadges` na chamada de `buildGroups({ ... ctrlFullView, navBadges })`.
  3. Em `BuildInput`, acrescente `navBadges?: Readonly<Record<string, number>>;`.
  4. Em `buildGroups`, acrescente `navBadges,` ao destructuring e troque a linha `items.push({ key: item.key, title: item.title, href, icon: item.icon });` por:
     ```ts
      const badge = navBadges?.[item.key];
      items.push({ key: item.key, title: item.title, href, icon: item.icon, ...(badge != null && badge > 0 ? { badge } : {}) });
     ```
  (`RenderItem.badge` e o `<span className="ch-navitem__badge">` já existem.)

- [ ] **Step 3: Repassar pelo shell** — em `src/components/app/app-shell.tsx`: em `AppShellProps`, depois de `unreadNotifications?: number;`, acrescente `navBadges?: Readonly<Record<string, number>>;`; acrescente `navBadges,` ao destructuring de `AppShell`; em `sidebarNav`, acrescente `navBadges={navBadges}` ao `<NavLinks … />` (depois de `ctrlFullView={ctrlFullView}`).

- [ ] **Step 4: Contar no layout do VB** — em `src/app/(vb)/vb/layout.tsx`: acrescente os imports `import { VB_NAV_KEY_OMIE } from "@/lib/auth/vb";` e `import { countPendingMovements } from "@/lib/vb/omie/queries";`; logo depois de `const unreadNotifications = …;` acrescente:

```ts
  // O menu nunca derruba o app: falha na contagem vira zero.
  const omiePending = vbRole === "gestor" ? await countPendingMovements().catch(() => 0) : 0;
```

e passe `navBadges={{ [VB_NAV_KEY_OMIE]: omiePending }}` ao `<AppShell … />` (depois de `unreadNotifications={unreadNotifications}`).

- [ ] **Step 5: Faixa na Visão geral** — em `src/app/(vb)/vb/page.tsx`: importe `VB_OMIE_PATH` de `@/lib/auth/vb` e `countPendingMovements` de `@/lib/vb/omie/queries`; no `Promise.all`, acrescente `isGestor ? countPendingMovements() : Promise.resolve(0),` como 4º item e `omiePending` ao destructuring; logo depois do bloco `{pendingBatch && (…)}` acrescente:

```tsx
      {isGestor && omiePending > 0 && (
        <div className="flex items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <span className="text-ink-primary">
            {omiePending} pagamento{omiePending === 1 ? "" : "s"} da Omie aguarda{omiePending === 1 ? "" : "m"} triagem.
          </span>
          <Link href={VB_OMIE_PATH} className="ml-auto font-medium underline">
            Triar
          </Link>
        </div>
      )}
```

- [ ] **Step 6: CLAUDE.md** — na seção "### Módulo VB (`/vb`, Viva Bank)", logo antes do bullet "- Escrita nas tabelas `vb_*`…", acrescente:

```markdown
- **Triagem da Omie (`/vb/omie`, só gestor)**: os pagamentos da ABD Holding (`VB_OMIE_COMPANY_ID`, `src/lib/vb/omie/config.ts`) vêm do sync diário do DRE — a tela lê `financial_entries` (tipo `despesa`, data ≥ `VB_OMIE_START_DATE`) e **não** tem integração própria com a Omie; "Buscar na Omie" só dispara o mesmo `runCompanySyncAsSystem(…, "rolling")` do cron. A decisão por movimento fica em `vb_omie_triage` (chave única `(company_id, omie_id)`, status `vinculado`/`descartado`, com retrato do pagamento porque o sync apaga o que some da Omie); **pendente não é gravado** — é candidato sem decisão. Vincular reaproveita o diálogo multi-linha (`VbEntryDialog` com `omie`): grava os lançamentos com `group_id`, depois a decisão, e apaga os lançamentos se a decisão falhar (`src/lib/vb/actions/omie.ts`). Desvincular apaga o grupo e devolve o movimento — é a única exclusão de lançamento aprovado que existe. Sugestões (`src/lib/vb/omie/suggest.ts`, puro e testado) só propõem credor e tipo. Leituras e escritas desta tela usam o admin client depois do gate de gestor, porque as policies de `financial_entries` dependem de vínculo com a empresa. O contador do menu vem do layout `(vb)` (`navBadges`). O extrato do credor não mostra origem Omie.
```

- [ ] **Step 7: Validar e commitar**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: sem erros; 64 testes.

```bash
git add src/components/app/navigation.ts src/components/app/nav-links.tsx src/components/app/app-shell.tsx 'src/app/(vb)/vb/layout.tsx' 'src/app/(vb)/vb/page.tsx' CLAUDE.md
git commit -m "feat(vb): item Omie no menu com contador, faixa de pendentes na Visão geral e docs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Verificação final (controlador)

1. `npm run lint && npm test && npx tsc --noEmit` na branch inteira.
2. Migration aplicada em produção (MCP) **antes** de o dono testar a tela — a Task 1 só cria o arquivo.
3. Roteiro manual da spec (seção 10): descartar/restaurar o "APORTE EMPRESA" de 10/09, "Buscar na Omie", vincular e desvincular um pagamento real, conferir extrato do credor e a aba Vinculados.
