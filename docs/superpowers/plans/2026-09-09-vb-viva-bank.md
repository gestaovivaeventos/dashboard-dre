# Módulo VB (Viva Bank) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trazer o histórico da planilha VB (créditos de sócios/credores) para o Control Hub como um módulo próprio, com importação revisada e aprovada antes de virar oficial, extrato por credor e visão geral.

**Architecture:** Módulo `vb` com route group `(vb)`, três tabelas `vb_*` no Supabase (credores, lançamentos, lotes de importação) e acesso por concessão em `user_module_roles` (sem override de admin). A importação parseia o `.xlsx` numa função pura, grava os lançamentos como `pendente` dentro da própria `vb_entries`, e a tela de revisão compara o saldo da planilha com o saldo somado pelo sistema antes de o gestor aprovar. Saldo nunca é gravado: é soma em ordem de data.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Supabase (Postgres + RLS, service role para escrita), `xlsx` (SheetJS 0.18) para ler a planilha, `zod` 4 nos server actions, shadcn/ui + Tailwind, testes com `node --test` + `tsx` (já instalado).

**Spec:** `docs/superpowers/specs/2026-09-09-vb-viva-bank-design.md`

## Global Constraints

- Texto de interface e mensagens de erro em português; identificadores e comentários técnicos em inglês (ou português curto, como o resto do código do módulo Compras).
- Estilo: aspas duplas e ponto-e-vírgula (padrão da maioria dos arquivos; `next lint` passa nos dois).
- Valores em `numeric(14,2)`, com sinal: entrada > 0, saída < 0, rendimento com o sinal da planilha. Somas sempre em centavos inteiros (`toCents`/`fromCents`).
- Data do lançamento = coluna B da planilha; coluna A só alimenta `period_start` dos rendimentos. Serial Excel < 1000 é data inválida.
- **Admin não passa por cima**: só a linha `user_module_roles(module='vb')` libera o módulo. Nenhuma coluna nova em `users`.
- Escrita nas tabelas `vb_*` só pelo admin client (service role) depois de `requireVbGestor()`; leitura nas páginas com o client do usuário (RLS).
- Toda função `SECURITY DEFINER` que não é predicado de policy termina com `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;`.
- Migration: mostrar o SQL ao Marcelo e esperar "ok" antes de aplicar (regra dele para DDL). Aplicar com `mcp__claude_ai_Supabase__apply_migration` no projeto do dashboard-dre (`hlophikvgtqoexqwxxis`), dizendo antes em uma linha qual projeto está sendo acessado.
- Tolerância de arredondamento planilha × sistema: R$ 1,00 por credor (`VB_BALANCE_TOLERANCE`).
- Não criar componente Tabs nem instalar dependência nova.
- Commits pequenos, um por task, no branch `feat/vb-module`, terminando com `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Rodar testes: `npm test` (roda `node --import tsx --test "src/**/*.test.ts"`). Validar sempre com `npm run lint` e `npm run build` antes de dar a task por concluída.

---

### Task 1: Migration e tipos do módulo

**Files:**
- Create: `supabase/migrations/20260909120000_vb_module.sql`
- Create: `src/lib/vb/types.ts`
- Modify: `src/lib/supabase/types.ts` (adicionar `VbRole` antes de `export interface ModuleAccess`)

**Interfaces:**
- Produces: tabelas `vb_creditors`, `vb_entries`, `vb_import_batches`; função `public.vb_role()`; função `public.vb_approve_import_batch(uuid, uuid)`; trigger `vb_touch_updated_at`; tipos `VbCreditor`, `VbEntry`, `VbImportBatch`, `VbImportSummary`, `VbEntryFlag`, `VB_BLOCKING_FLAGS`, `VB_FLAG_LABELS`, `isBlockingFlag`, `VB_BALANCE_TOLERANCE`, `VbActionResult`, `VbRole`.

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migrations/20260909120000_vb_module.sql`:

```sql
-- Módulo VB (Viva Bank): créditos de sócios/credores que emprestaram ao grupo
-- na construção do Terrazzo. Substitui a planilha "VB TERRAZZO".
--
-- Desenho: docs/superpowers/specs/2026-09-09-vb-viva-bank-design.md
--
-- • Acesso por concessão em user_module_roles (module='vb', role 'gestor' |
--   'credor'). Admin NÃO passa por cima — sem a linha, não vê o módulo.
-- • Saldo nunca é gravado: é a soma de vb_entries.amount em ordem de data.
--   sheet_balance guarda o SALDO que a planilha mostrava, só para a revisão.
-- • A importação grava lançamentos com status 'pendente' na própria
--   vb_entries; aprovar o lote muda o status. Não há área de rascunho.

-- ── Tabelas ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.vb_creditors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT true,
  -- Fase 2: sócio logado vendo o próprio extrato (papel 'credor').
  user_id       UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  -- Nome da aba de origem na planilha. Único: é a chave que impede reimportar
  -- um credor já aprovado.
  source_sheet  TEXT NULL,
  sort_order    INT NOT NULL DEFAULT 0,
  notes         TEXT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS vb_creditors_source_sheet_uniq
  ON public.vb_creditors (lower(source_sheet)) WHERE source_sheet IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.vb_import_batches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pendente'
                CHECK (status IN ('pendente', 'aprovado', 'descartado')),
  -- Relatório do parser (abas ignoradas/vazias/puladas, totais por credor).
  summary       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by    UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by   UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at   TIMESTAMPTZ NULL,
  discarded_at  TIMESTAMPTZ NULL
);

-- Só um lote pendente por vez (índice único parcial sobre um valor constante).
CREATE UNIQUE INDEX IF NOT EXISTS vb_import_batches_single_pending
  ON public.vb_import_batches ((status)) WHERE status = 'pendente';

CREATE TABLE IF NOT EXISTS public.vb_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creditor_id     UUID NOT NULL REFERENCES public.vb_creditors(id) ON DELETE CASCADE,
  entry_date      DATE NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('entrada', 'saida', 'rendimento')),
  -- Com sinal: entrada > 0, saída < 0, rendimento com o sinal da planilha.
  amount          NUMERIC(14,2) NOT NULL,
  description     TEXT NULL,
  -- Só rendimento. days segue a convenção da planilha: period_end - period_start.
  period_start    DATE NULL,
  period_end      DATE NULL,
  days            INT NULL,
  -- Fração (0.0335 = 3,35%).
  rate            NUMERIC(12,8) NULL,
  -- mensal = taxa fixa capitalizada por dia (FV); periodo = saldo × taxa do
  -- período; ajuste = valor digitado; cdi = reservado aos juros automáticos.
  rate_basis      TEXT NULL CHECK (rate_basis IN ('mensal', 'periodo', 'ajuste', 'cdi')),
  status          TEXT NOT NULL DEFAULT 'aprovado' CHECK (status IN ('pendente', 'aprovado')),
  import_batch_id UUID NULL REFERENCES public.vb_import_batches(id) ON DELETE RESTRICT,
  source_row      INT NULL,
  sheet_balance   NUMERIC(16,4) NULL,
  -- Importação: linha × 10 + sub (0 rendimento, 1 entrada, 2 saída). Manual: 0.
  sort_order      INT NOT NULL DEFAULT 0,
  flags           TEXT[] NOT NULL DEFAULT '{}',
  created_by      UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Pendente pode carregar valor inválido (0) até o gestor corrigir; aprovado não.
  CONSTRAINT vb_entries_amount_sign CHECK (
    status = 'pendente'
    OR (kind = 'entrada' AND amount > 0)
    OR (kind = 'saida' AND amount < 0)
    OR (kind = 'rendimento' AND amount <> 0)
  ),
  CONSTRAINT vb_entries_period_pair CHECK (
    (period_start IS NULL AND period_end IS NULL)
    OR (period_start IS NOT NULL AND period_end IS NOT NULL AND period_start <= period_end)
  )
);

CREATE INDEX IF NOT EXISTS vb_entries_creditor_order_idx
  ON public.vb_entries (creditor_id, entry_date, sort_order, created_at);
CREATE INDEX IF NOT EXISTS vb_entries_batch_idx
  ON public.vb_entries (import_batch_id) WHERE import_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vb_entries_pending_idx
  ON public.vb_entries (status) WHERE status = 'pendente';

-- ── updated_at ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.vb_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vb_creditors_touch_updated_at ON public.vb_creditors;
CREATE TRIGGER vb_creditors_touch_updated_at
  BEFORE UPDATE ON public.vb_creditors
  FOR EACH ROW EXECUTE FUNCTION public.vb_touch_updated_at();

DROP TRIGGER IF EXISTS vb_entries_touch_updated_at ON public.vb_entries;
CREATE TRIGGER vb_entries_touch_updated_at
  BEFORE UPDATE ON public.vb_entries
  FOR EACH ROW EXECUTE FUNCTION public.vb_touch_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────

ALTER TABLE public.vb_creditors      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vb_entries        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vb_import_batches ENABLE ROW LEVEL SECURITY;

-- Papel do usuário no VB ('gestor' | 'credor' | NULL). Predicado de policy:
-- fica executável por authenticated (regra da auditoria de 03/09/2026).
CREATE OR REPLACE FUNCTION public.vb_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.user_module_roles
  WHERE user_id = auth.uid() AND module = 'vb'
  ORDER BY (role <> 'gestor'), role
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.vb_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vb_role() TO authenticated, service_role;

DROP POLICY IF EXISTS vb_creditors_select ON public.vb_creditors;
CREATE POLICY vb_creditors_select ON public.vb_creditors
  FOR SELECT TO authenticated
  USING (
    public.vb_role() = 'gestor'
    OR (public.vb_role() = 'credor' AND user_id = auth.uid())
  );

DROP POLICY IF EXISTS vb_entries_select ON public.vb_entries;
CREATE POLICY vb_entries_select ON public.vb_entries
  FOR SELECT TO authenticated
  USING (
    (status = 'aprovado' OR public.vb_role() = 'gestor')
    AND EXISTS (
      SELECT 1 FROM public.vb_creditors c
      WHERE c.id = vb_entries.creditor_id
        AND (
          public.vb_role() = 'gestor'
          OR (public.vb_role() = 'credor' AND c.user_id = auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS vb_import_batches_select ON public.vb_import_batches;
CREATE POLICY vb_import_batches_select ON public.vb_import_batches
  FOR SELECT TO authenticated
  USING (public.vb_role() = 'gestor');

-- Sem policy de escrita: toda escrita passa pelo service role, nos server
-- actions, depois de requireVbGestor().

-- ── Aprovação do lote (transação única) ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.vb_approve_import_batch(p_batch_id UUID, p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status   TEXT;
  v_blocking INTEGER;
  v_count    INTEGER;
BEGIN
  SELECT status INTO v_status
  FROM public.vb_import_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Lote não encontrado.';
  END IF;
  IF v_status <> 'pendente' THEN
    RAISE EXCEPTION 'Lote não está pendente.';
  END IF;

  SELECT count(*) INTO v_blocking
  FROM public.vb_entries
  WHERE import_batch_id = p_batch_id
    AND status = 'pendente'
    AND flags && ARRAY['data_invalida', 'valor_invalido']::text[];

  IF v_blocking > 0 THEN
    RAISE EXCEPTION 'Há % lançamento(s) com alerta bloqueante. Corrija antes de aprovar.', v_blocking;
  END IF;

  UPDATE public.vb_entries
  SET status = 'aprovado'
  WHERE import_batch_id = p_batch_id AND status = 'pendente';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.vb_import_batches
  SET status = 'aprovado', approved_by = p_user_id, approved_at = now()
  WHERE id = p_batch_id;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.vb_approve_import_batch(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vb_approve_import_batch(UUID, UUID) TO service_role;

-- ── Concessão inicial ───────────────────────────────────────────────────
-- Só o Marcelo enxerga o módulo no começo. Lookup por e-mail, sem UUID fixo.

INSERT INTO public.user_module_roles (user_id, module, role)
SELECT id, 'vb', 'gestor'
FROM public.users
WHERE lower(email) = 'marcelo@quokka.net.br'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE public.vb_creditors IS
  'VB (Viva Bank): credores/sócios que emprestaram ao grupo. Acesso por concessão em user_module_roles (module=vb).';
COMMENT ON TABLE public.vb_entries IS
  'VB: lançamentos (entrada/saida/rendimento) por credor. Saldo = soma de amount em ordem de data. status=pendente enquanto o lote de importação não é aprovado.';
COMMENT ON TABLE public.vb_import_batches IS
  'VB: lotes de importação da planilha. Um pendente por vez; linhas nunca são apagadas.';
```

- [ ] **Step 2: Mostrar o SQL ao Marcelo e esperar "ok"**

Dizer em uma linha: "Rodando no Supabase do dashboard-dre (hlophikvgtqoexqwxxis)". Colar o SQL. Só seguir depois do "ok".

- [ ] **Step 3: Aplicar a migration**

Usar `mcp__claude_ai_Supabase__apply_migration` com `project_id: hlophikvgtqoexqwxxis`, `name: vb_module` e `query` = o conteúdo do arquivo. Depois confirmar com `mcp__claude_ai_Supabase__execute_sql`:

```sql
SELECT u.email, r.module, r.role
FROM public.user_module_roles r JOIN public.users u ON u.id = r.user_id
WHERE r.module = 'vb';
```

Esperado: uma linha, `marcelo@quokka.net.br | vb | gestor`.

Rodar `mcp__claude_ai_Supabase__get_advisors` (`type: security`): não pode aparecer `authenticated_security_definer_function_executable` para `vb_approve_import_batch`. `vb_role` pode aparecer como predicado (mesma situação de `has_ctrl_role`).

- [ ] **Step 4: Tipo `VbRole` no types.ts do Supabase**

Em `src/lib/supabase/types.ts`, logo antes de `export interface ModuleAccess {`, adicionar:

```ts
/** Papel no módulo VB (Viva Bank). Concedido em user_module_roles — ver @/lib/auth/vb. */
export type VbRole = "gestor" | "credor";
```

- [ ] **Step 5: Tipos do módulo**

Criar `src/lib/vb/types.ts`:

```ts
// Tipos do módulo VB (Viva Bank). Espelham as tabelas vb_* da migration
// 20260909120000_vb_module.sql. O `types.ts` do Supabase é escrito à mão neste
// projeto (não há Database gerado), então as linhas das tabelas vivem aqui,
// junto do módulo.

export type VbEntryKind = "entrada" | "saida" | "rendimento";
export type VbRateBasis = "mensal" | "periodo" | "ajuste" | "cdi";
export type VbEntryStatus = "pendente" | "aprovado";
export type VbBatchStatus = "pendente" | "aprovado" | "descartado";

export type VbEntryFlag =
  | "data_invalida"
  | "valor_invalido"
  | "fora_de_ordem"
  | "conferir"
  | "sem_descricao"
  | "periodo_inferido"
  | "dias_divergentes"
  | "entrada_e_saida";

/** Flags que impedem a aprovação do lote (mesma lista da função SQL vb_approve_import_batch). */
export const VB_BLOCKING_FLAGS: ReadonlySet<VbEntryFlag> = new Set<VbEntryFlag>([
  "data_invalida",
  "valor_invalido",
]);

export const VB_FLAG_LABELS: Record<VbEntryFlag, string> = {
  data_invalida: "Data inválida",
  valor_invalido: "Valor inválido",
  fora_de_ordem: "Data fora de ordem",
  conferir: "Marcado 'CONFERIR' na planilha",
  sem_descricao: "Sem descrição",
  periodo_inferido: "Período do rendimento inferido",
  dias_divergentes: "Dias diferentes da planilha",
  entrada_e_saida: "Entrada e saída na mesma linha",
};

export function isBlockingFlag(flag: string): boolean {
  return VB_BLOCKING_FLAGS.has(flag as VbEntryFlag);
}

/** Diferença planilha × sistema tolerada como arredondamento (R$ por credor). */
export const VB_BALANCE_TOLERANCE = 1;

export const VB_KIND_LABELS: Record<VbEntryKind, string> = {
  entrada: "Entrada",
  saida: "Saída",
  rendimento: "Rendimento",
};

export interface VbCreditor {
  id: string;
  name: string;
  active: boolean;
  user_id: string | null;
  source_sheet: string | null;
  sort_order: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface VbEntry {
  id: string;
  creditor_id: string;
  /** 'YYYY-MM-DD' */
  entry_date: string;
  kind: VbEntryKind;
  /** Com sinal: entrada > 0, saída < 0, rendimento ±. */
  amount: number;
  description: string | null;
  period_start: string | null;
  period_end: string | null;
  days: number | null;
  /** Fração (0.0335 = 3,35%). */
  rate: number | null;
  rate_basis: VbRateBasis | null;
  status: VbEntryStatus;
  import_batch_id: string | null;
  source_row: number | null;
  /** SALDO que a planilha mostrava nesta linha (só importados). */
  sheet_balance: number | null;
  sort_order: number;
  flags: VbEntryFlag[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface VbImportCreditorSummary {
  creditorId: string;
  sheetName: string;
  name: string;
  hidden: boolean;
  entries: number;
  skippedRows: number;
  sheetFinalBalance: number | null;
  computedFinalBalance: number;
  diff: number | null;
  blockingCount: number;
  warningCount: number;
}

export interface VbImportSummary {
  creditors: VbImportCreditorSummary[];
  skippedSheets: Array<{ sheetName: string; reason: "ja_importado" }>;
  emptySheets: string[];
  ignoredSheets: string[];
}

export interface VbImportBatch {
  id: string;
  file_name: string;
  status: VbBatchStatus;
  summary: VbImportSummary;
  created_by: string | null;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
  discarded_at: string | null;
}

/** Retorno padrão dos server actions do módulo. */
export type VbActionResult<T extends object = Record<never, never>> =
  | ({ ok: true } & T)
  | { error: string };

export const EMPTY_IMPORT_SUMMARY: VbImportSummary = {
  creditors: [],
  skippedSheets: [],
  emptySheets: [],
  ignoredSheets: [],
};
```

- [ ] **Step 6: Lint e commit**

```bash
npm run lint
git add supabase/migrations/20260909120000_vb_module.sql src/lib/vb/types.ts src/lib/supabase/types.ts
git commit -m "feat(vb): migration das tabelas vb_* e tipos do módulo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Concessão, sessão e guarda do módulo

**Files:**
- Create: `src/lib/auth/vb.ts`
- Create: `src/lib/auth/vb.test.ts`
- Create: `src/lib/vb/auth.ts`
- Modify: `src/lib/auth/session.ts`
- Modify: `src/lib/supabase/types.ts` (`ModuleAccess.vb`, `UnifiedProfile.vb_role`)
- Modify: `package.json` (script `test`)

**Interfaces:**
- Consumes: `VbRole` (Task 1).
- Produces: `VB_MODULE`, `VB_PATH`, `VB_NAV_KEY_OVERVIEW`, `VB_NAV_KEY_IMPORT`, `hasVbGrant(rows)`, `resolveVbRole(rows)`, `isVbPath(pathname)`; `ctx.modules.vb: { role: VbRole } | null`; `profile.vb_role`; `hasVbAccess(ctx)`, `isVbGestor(ctx)`; `getVbUser()`, `requireVbUser()`, `requireVbGestor()` devolvendo `VbUserContext { id, name, email, role }`.

- [ ] **Step 1: Script de teste no package.json**

Em `package.json`, dentro de `"scripts"`, adicionar depois de `"lint"`:

```json
    "test": "node --import tsx --test \"src/**/*.test.ts\""
```

- [ ] **Step 2: Escrever o teste da concessão (falha)**

Criar `src/lib/auth/vb.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { hasVbGrant, isVbPath, resolveVbRole } from "@/lib/auth/vb";

test("resolveVbRole: sem linha → null", () => {
  assert.equal(resolveVbRole([]), null);
  assert.equal(resolveVbRole(null), null);
});

test("resolveVbRole: ignora outros módulos", () => {
  assert.equal(resolveVbRole([{ module: "ctrl", role: "gestor" }, { module: "contratos", role: "validador" }]), null);
});

test("resolveVbRole: credor", () => {
  assert.equal(resolveVbRole([{ module: "vb", role: "credor" }]), "credor");
});

test("resolveVbRole: gestor prevalece sobre credor", () => {
  assert.equal(resolveVbRole([{ module: "vb", role: "credor" }, { module: "vb", role: "gestor" }]), "gestor");
});

test("resolveVbRole: papel desconhecido não concede nada", () => {
  assert.equal(resolveVbRole([{ module: "vb", role: "admin" }]), null);
});

test("hasVbGrant: basta o módulo (select enxuto do middleware)", () => {
  assert.equal(hasVbGrant([{ module: "vb" }]), true);
  assert.equal(hasVbGrant([{ module: "ctrl" }]), false);
  assert.equal(hasVbGrant(undefined), false);
});

test("isVbPath", () => {
  assert.equal(isVbPath("/vb"), true);
  assert.equal(isVbPath("/vb/importar/abc"), true);
  assert.equal(isVbPath("/vbx"), false);
  assert.equal(isVbPath("/ctrl/vb"), false);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/auth/vb'`.

- [ ] **Step 4: Implementar `src/lib/auth/vb.ts`**

```ts
import type { VbRole } from "@/lib/supabase/types";

/**
 * Módulo VB (Viva Bank) — controle dos créditos de sócios/credores.
 *
 * ── Onde o acesso é gravado ────────────────────────────────────────────────
 * Numa linha de `user_module_roles` (module='vb', role='gestor' | 'credor'),
 * o mesmo caminho do módulo Validação de Contratos (ver @/lib/auth/contratos):
 * nenhuma coluna nova em `users`, então nada de migration travando o select
 * explícito de getSessionContext.
 *
 * ── Admin NÃO passa por cima ───────────────────────────────────────────────
 * Diferente dos outros módulos, `profile === 'admin'` não dá acesso ao VB. O
 * módulo é de um grupo fechado de pessoas; a única porta é a concessão
 * explícita — mesma filosofia das empresas restritas
 * (@/lib/auth/restricted-companies). Quem precisar liberar alguém insere a
 * linha (fase 2: botão em Usuários > "Módulos visíveis").
 *
 * Client-safe: só constantes e funções puras.
 */
export const VB_MODULE = "vb";

/** Rota raiz do módulo. */
export const VB_PATH = "/vb";

/** Chaves dos itens do grupo VB no menu lateral. */
export const VB_NAV_KEY_OVERVIEW = "vb-overview";
export const VB_NAV_KEY_IMPORT = "vb-import";

/**
 * Há alguma concessão do módulo? Aceita o select enxuto do middleware e da
 * root page (`{ module }`), que não traz o papel.
 */
export function hasVbGrant(
  rows: Array<{ module?: string | null }> | null | undefined,
): boolean {
  return (rows ?? []).some((row) => row?.module === VB_MODULE);
}

/**
 * Papel efetivo no VB a partir das linhas de `user_module_roles` (join do
 * getSessionContext, `{ module, role }`). Com as duas linhas, `gestor`
 * prevalece. Papel desconhecido não concede nada.
 */
export function resolveVbRole(
  rows: Array<{ module?: string | null; role?: string | null }> | null | undefined,
): VbRole | null {
  let role: VbRole | null = null;
  for (const row of rows ?? []) {
    if (row?.module !== VB_MODULE) continue;
    if (row.role === "gestor") return "gestor";
    if (row.role === "credor") role = "credor";
  }
  return role;
}

export function isVbPath(pathname: string): boolean {
  return pathname === VB_PATH || pathname.startsWith(`${VB_PATH}/`);
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test`
Expected: 7 testes, `pass 7`.

- [ ] **Step 6: Sessão — `ModuleAccess` e `UnifiedProfile`**

Em `src/lib/supabase/types.ts`, dentro de `export interface ModuleAccess`, depois do campo `contratos`, adicionar:

```ts
  /**
   * Módulo VB (Viva Bank). Concessão em user_module_roles (module='vb') — ver
   * `@/lib/auth/vb`. Admin não recebe automaticamente.
   */
  vb: { role: VbRole } | null;
```

Dentro de `export interface UnifiedProfile`, depois de `can_contratos: boolean;`, adicionar:

```ts
  /**
   * Papel no módulo VB (Viva Bank), ou null sem concessão. Como `can_contratos`,
   * vem de `user_module_roles`, não de coluna de `users` — ver `@/lib/auth/vb`.
   */
  vb_role: VbRole | null;
```

- [ ] **Step 7: Sessão — `session.ts`**

Em `src/lib/auth/session.ts`:

1. Importar, junto dos outros imports de `@/lib/auth/*`:

```ts
import { resolveVbRole } from "@/lib/auth/vb";
```

2. Depois de `hasContratosAccess`, adicionar os helpers:

```ts
export function hasVbAccess(ctx: SessionContext): boolean {
  return Boolean(ctx.modules?.vb);
}

export function isVbGestor(ctx: SessionContext): boolean {
  return ctx.modules?.vb?.role === "gestor";
}
```

3. Dentro de `loadSessionContext`, logo depois do bloco que calcula `canContratos`, adicionar:

```ts
  // Módulo VB (Viva Bank): só a concessão em user_module_roles. Sem override
  // de admin, de propósito — ver @/lib/auth/vb.
  const vbRole = resolveVbRole(moduleRoleRows);
```

4. No objeto `profile`, depois de `can_contratos: canContratos,`, adicionar `vb_role: vbRole,`.

5. No objeto `modules`, depois de `contratos: canContratos ? {} : null,`, adicionar `vb: vbRole ? { role: vbRole } : null,`.

- [ ] **Step 8: Guarda dos server actions — `src/lib/vb/auth.ts`**

```ts
import { getSessionContext } from "@/lib/auth/session";
import type { VbRole } from "@/lib/supabase/types";

export interface VbUserContext {
  id: string;
  name: string | null;
  email: string;
  role: VbRole;
}

/** Contexto do usuário no VB, ou null sem concessão (admin incluso). */
export async function getVbUser(): Promise<VbUserContext | null> {
  const ctx = await getSessionContext();
  if (!ctx.user || !ctx.profile || !ctx.modules?.vb) return null;
  return {
    id: ctx.profile.id,
    name: ctx.profile.name,
    email: ctx.profile.email,
    role: ctx.modules.vb.role,
  };
}

/** Qualquer papel do módulo. Lança "Acesso negado." sem concessão. */
export async function requireVbUser(): Promise<VbUserContext> {
  const user = await getVbUser();
  if (!user) throw new Error("Acesso negado.");
  return user;
}

/** Só gestor: importação, lançamentos, edição de credor. */
export async function requireVbGestor(): Promise<VbUserContext> {
  const user = await requireVbUser();
  if (user.role !== "gestor") throw new Error("Acesso negado.");
  return user;
}
```

- [ ] **Step 9: Lint, build e commit**

```bash
npm run lint && npm run build
git add package.json src/lib/auth/vb.ts src/lib/auth/vb.test.ts src/lib/vb/auth.ts src/lib/auth/session.ts src/lib/supabase/types.ts
git commit -m "feat(vb): concessão do módulo na sessão e guarda de gestor

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Autorização de rota (access.ts, middleware, root page)

**Files:**
- Modify: `src/lib/auth/access.ts`
- Modify: `src/lib/supabase/middleware.ts`
- Modify: `src/app/page.tsx`
- Create: `src/lib/auth/access-vb.test.ts`

**Interfaces:**
- Consumes: `hasVbGrant`, `isVbPath` (Task 2).
- Produces: `canAccessPathByProfile(..., email, canVb)` (9º parâmetro) e `defaultLandingFor(..., canContratos, canVb)` (7º parâmetro).

- [ ] **Step 1: Teste (falha)**

Criar `src/lib/auth/access-vb.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { canAccessPathByProfile, defaultLandingFor } from "@/lib/auth/access";

// (pathname, profile, canFinanceiro, canCompras, canCase, canViagens, canContratos, email, canVb)

test("/vb: admin SEM concessão é negado (sem override)", () => {
  assert.equal(
    canAccessPathByProfile("/vb", "admin", true, true, true, false, true, "x@y.z", false),
    false,
  );
});

test("/vb: admin COM concessão entra", () => {
  assert.equal(
    canAccessPathByProfile("/vb/importar", "admin", true, true, false, false, false, null, true),
    true,
  );
});

test("/vb: franqueado com concessão entra (gate vem antes da whitelist)", () => {
  assert.equal(
    canAccessPathByProfile("/vb", "franqueado", true, false, false, false, false, null, true),
    true,
  );
});

test("/vb: perfil de Compras sem concessão é negado", () => {
  assert.equal(
    canAccessPathByProfile("/vb", "gerente", false, true, false, false, false, null, false),
    false,
  );
});

test("/vb não vaza para prefixos parecidos", () => {
  // /vbx não existe; cai no default permissivo de rota não mapeada para admin.
  assert.equal(canAccessPathByProfile("/vbx", "admin", true, true, false, false, false, null, false), true);
});

test("defaultLandingFor: quem só tem o VB cai na home, não em /pendente", () => {
  assert.equal(defaultLandingFor("solicitante", false, false, false, false, false, true), "/home");
  assert.equal(defaultLandingFor("solicitante", false, false, false, false, false, false), "/pendente");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: os testes de `/vb` falham (o admin entra e o franqueado é negado, porque o parâmetro ainda não existe).

- [ ] **Step 3: `access.ts`**

1. Importar `isVbPath`:

```ts
import { isVbPath } from "@/lib/auth/vb";
```

2. Em `defaultLandingFor`, adicionar o parâmetro `canVb: boolean = false` depois de `canContratos: boolean = false,` e incluir `canVb ||` na condição, ficando:

```ts
  if (
    canFinanceiro ||
    canCompras ||
    canCase ||
    canViagens ||
    canContratos ||
    canVb ||
    profile === "admin"
  ) {
    return "/home";
  }
```

3. Em `canAccessPathByProfile`, adicionar o último parâmetro depois de `email: string | null = null,`:

```ts
  /**
   * Módulo VB (Viva Bank). Só a concessão em user_module_roles libera; admin
   * NÃO passa por cima — ver @/lib/auth/vb.
   */
  canVb: boolean = false,
```

4. Logo depois do bloco `if (pathname === "/contratos" || pathname.startsWith("/contratos/")) { ... }`, e ANTES do bloco `if (profile === "franqueado" || profile === "csc")`, adicionar:

```ts
  // Módulo VB (Viva Bank): só a concessão explícita libera. Precisa vir antes
  // do bloco franqueado/CSC (a whitelist negaria a rota) e antes de "Admin:
  // tudo" — admin sem a linha não vê o módulo, de propósito.
  if (isVbPath(pathname)) return canVb;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: todos passam.

- [ ] **Step 5: Middleware**

Em `src/lib/supabase/middleware.ts`:

1. Importar: `import { hasVbGrant } from "@/lib/auth/vb";`
2. Depois do cálculo de `canContratos`, adicionar:

```ts
    // Módulo VB (Viva Bank): só a concessão. Sem override de admin.
    const canVb = hasVbGrant(profileData?.user_module_roles);
```

3. Na chamada `canAccessPathByProfile(...)`, adicionar `canVb,` como último argumento (depois de `user.email ?? null,`).
4. Na chamada `defaultLandingFor(...)` do redirect, adicionar `canVb,` depois de `canContratos,`.

- [ ] **Step 6: Root page**

Em `src/app/page.tsx`:

1. Importar: `import { hasVbGrant } from "@/lib/auth/vb";`
2. Depois de `const canContratos = ...;`, adicionar:

```ts
  const canVb = hasVbGrant(profileRow.user_module_roles);
```

3. Na chamada `defaultLandingFor(...)`, adicionar `canVb,` depois de `canContratos,`.

- [ ] **Step 7: Lint, build e commit**

```bash
npm run lint && npm run build
git add src/lib/auth/access.ts src/lib/auth/access-vb.test.ts src/lib/supabase/middleware.ts src/app/page.tsx
git commit -m "feat(vb): gate de rota /vb sem override de admin

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Parser da planilha (função pura) e script de conferência

**Files:**
- Create: `src/lib/vb/money.ts`
- Create: `src/lib/vb/money.test.ts`
- Create: `src/lib/vb/import/excel-date.ts`
- Create: `src/lib/vb/import/excel-date.test.ts`
- Create: `src/lib/vb/import/parse-vb-workbook.ts`
- Create: `src/lib/vb/import/parse-vb-workbook.test.ts`
- Create: `scripts/vb-parse-check.ts`

**Interfaces:**
- Consumes: `VbEntryKind`, `VbRateBasis`, `VbEntryFlag`, `isBlockingFlag`, `VB_BALANCE_TOLERANCE` (Task 1).
- Produces: `roundCents(v)`, `toCents(v)`, `fromCents(c)`, `sumCents(values)`; `excelSerialToIsoDate(serial)`, `isoDateToExcelSerial(iso)`, `addDaysIso(iso, days)`, `diffDaysIso(a, b)`; `parseVbWorkbook(data: Uint8Array): ParsedWorkbook` com `ParsedWorkbook { creditors: ParsedCreditor[]; emptySheets: string[]; ignoredSheets: string[] }`, `ParsedCreditor { sheetName, name, hidden, entries: ParsedEntry[], skippedRows, sheetFinalBalance, computedFinalBalance, diff, blockingCount, warningCount }`, `ParsedEntry { sourceRow, sortOrder, entryDate, kind, amount, description, periodStart, periodEnd, days, rate, rateBasis, sheetBalance, flags }`.

- [ ] **Step 1: Teste do dinheiro (falha)**

Criar `src/lib/vb/money.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { fromCents, roundCents, sumCents, toCents } from "@/lib/vb/money";

test("roundCents arredonda para centavos, simétrico", () => {
  assert.equal(roundCents(3613.8951), 3613.9);
  assert.equal(roundCents(-6484.0004), -6484);
  assert.equal(roundCents(0.005), 0.01);
  assert.equal(roundCents(-0.005), -0.01);
  assert.equal(roundCents(1.005), 1.01); // Math.round(1.005*100) daria 1.00
  assert.equal(roundCents(0.004), 0);
});

test("toCents/fromCents são inteiros e voltam ao valor", () => {
  assert.equal(toCents(331092.83), 33109283);
  assert.equal(toCents(-258593.57), -25859357);
  assert.equal(fromCents(33109283), 331092.83);
  assert.equal(Number.isInteger(toCents(0.1 + 0.2)), true);
});

test("sumCents soma sem erro binário", () => {
  assert.equal(fromCents(sumCents([0.1, 0.2, 0.3])), 0.6);
  assert.equal(fromCents(sumCents([40000, -37000, 3613.9])), 6613.9);
});
```

- [ ] **Step 2: Implementar `src/lib/vb/money.ts`**

```ts
// Dinheiro do VB em centavos inteiros. Somar floats de duas casas acumula erro
// binário (0.1 + 0.2); toda soma passa por toCents.

/** Arredonda para centavos, simétrico em torno de zero (-1,005 → -1,01). */
export function roundCents(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * 100 + 1e-7)) / 100;
}

export function toCents(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(value) * 100 + 1e-7);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export function sumCents(values: readonly number[]): number {
  return values.reduce((acc, v) => acc + toCents(v), 0);
}
```

- [ ] **Step 3: Rodar e ver passar**

Run: `npm test`
Expected: os 3 testes de money passam.

- [ ] **Step 4: Teste das datas Excel (falha)**

Criar `src/lib/vb/import/excel-date.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addDaysIso,
  diffDaysIso,
  excelSerialToIsoDate,
  isoDateToExcelSerial,
} from "@/lib/vb/import/excel-date";

test("serial Excel → ISO (pares conhecidos)", () => {
  assert.equal(excelSerialToIsoDate(25569), "1970-01-01");
  assert.equal(excelSerialToIsoDate(43831), "2020-01-01");
  assert.equal(excelSerialToIsoDate(42954), "2017-08-07");
  assert.equal(excelSerialToIsoDate(42954.75), "2017-08-07"); // hora é ignorada
});

test("serial inválido (01/01/1900, vazio, texto) → null", () => {
  assert.equal(excelSerialToIsoDate(1), null);
  assert.equal(excelSerialToIsoDate(999), null);
  assert.equal(excelSerialToIsoDate(undefined), null);
  assert.equal(excelSerialToIsoDate("2017-08-07"), null);
  assert.equal(excelSerialToIsoDate(Number.NaN), null);
});

test("ISO → serial é o inverso", () => {
  assert.equal(isoDateToExcelSerial("2017-08-07"), 42954);
  assert.equal(excelSerialToIsoDate(isoDateToExcelSerial("2026-06-30")), "2026-06-30");
});

test("addDaysIso e diffDaysIso (convenção DIAS = fim - início)", () => {
  assert.equal(addDaysIso("2026-06-30", 1), "2026-07-01");
  assert.equal(addDaysIso("2024-02-28", 1), "2024-02-29");
  assert.equal(diffDaysIso("2026-01-02", "2026-03-31"), 88);
  assert.equal(diffDaysIso("2017-08-08", "2018-05-01"), 266);
  assert.equal(diffDaysIso("2026-01-01", "2026-01-01"), 0);
});
```

- [ ] **Step 5: Implementar `src/lib/vb/import/excel-date.ts`**

```ts
// Datas da planilha chegam como serial do Excel (dias desde 30/12/1899). O
// SheetJS é lido com cellDates:false de propósito: converter aqui, em UTC,
// evita o dia "pular" por fuso horário.

const MS_PER_DAY = 86_400_000;
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

/**
 * Abaixo disso é lixo de fórmula: `=B(anterior)+1` apontando célula vazia vira
 * serial 1 (01/01/1900). Nada no VB é anterior a 1902.
 */
export const MIN_VALID_SERIAL = 1000;

export function excelSerialToIsoDate(serial: unknown): string | null {
  if (typeof serial !== "number" || !Number.isFinite(serial)) return null;
  if (serial < MIN_VALID_SERIAL) return null;
  return new Date(EXCEL_EPOCH_UTC + Math.floor(serial) * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

export function isoDateToExcelSerial(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - EXCEL_EPOCH_UTC) / MS_PER_DAY);
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** `b - a` em dias de calendário — a convenção da coluna DIAS da planilha. */
export function diffDaysIso(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / MS_PER_DAY);
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npm test`
Expected: testes de excel-date passam.

- [ ] **Step 7: Teste do parser (falha)**

Criar `src/lib/vb/import/parse-vb-workbook.test.ts`. O helper monta uma planilha em memória com o mesmo layout da VB (cabeçalho na linha 4, dados a partir da 5) e escreve fórmulas nas células de RENDIMENTO:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import * as XLSX from "xlsx";

import { isoDateToExcelSerial } from "@/lib/vb/import/excel-date";
import { parseVbWorkbook } from "@/lib/vb/import/parse-vb-workbook";

const HEADER = ["DATA", "DATA", "DIAS", "DESCRIÇÃO", "ENTRADA", "SAÍDA", "RENDIMENTO", "SALDO", "TX "];

interface RowSpec {
  a?: string | number | null; // data início (ISO) ou serial cru
  b?: string | number | null; // data fim / data lançada
  c?: number | null;          // DIAS
  d?: string | null;          // descrição
  e?: number | null;          // entrada
  f?: number | null;          // saída
  g?: number | null;          // rendimento
  gFormula?: string;          // fórmula de G (sem "=")
  gError?: boolean;           // G = #REF!
  h?: number | null;          // saldo da planilha
  i?: number | null;          // taxa
}

function serial(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  return typeof v === "number" ? v : isoDateToExcelSerial(v);
}

function creditorSheet(name: string, rows: RowSpec[]): XLSX.WorkSheet {
  const aoa: unknown[][] = [[name], [], [], HEADER];
  for (const r of rows) {
    aoa.push([serial(r.a), serial(r.b), r.c ?? null, r.d ?? null, r.e ?? null, r.f ?? null, r.gError ? null : r.g ?? null, r.h ?? null, r.i ?? null]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  rows.forEach((r, idx) => {
    const ref = `G${5 + idx}`;
    if (r.gError) ws[ref] = { t: "e", v: 0x17, w: "#REF!" };
    else if (r.gFormula && r.g != null) ws[ref] = { t: "n", v: r.g, f: r.gFormula };
  });
  return ws;
}

function workbook(sheets: Array<{ name: string; ws: XLSX.WorkSheet; hidden?: boolean }>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, s.ws, s.name);
  wb.Workbook = { Sheets: sheets.map((s) => ({ name: s.name, Hidden: s.hidden ? 1 : 0 })) };
  return new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

const PEDRO: RowSpec[] = [
  { a: "2017-08-07", b: "2017-08-07", c: 0, d: "APORTE", e: 40000, g: 0, h: 40000 },
  { a: "2017-08-08", b: "2018-05-01", c: 266, d: "RENDIMENTO", g: 3613.8951, gFormula: "FV(J6,C6,0,-H5)-H5", h: 43613.8951, i: 0.01 },
  { a: "2018-05-02", b: "2020-07-30", c: 0, d: "RESGATE", f: 37000, g: 0, h: 6613.8951, i: 0.0038 },
  { a: "2026-01-02", b: "2026-03-31", c: 88, d: "RENDIMENTO", g: 221.5652, gFormula: "H7*I8", h: 6835.4603, i: 0.0335 },
];

test("reconhece aba de credor, ignora as outras e aponta a vazia", () => {
  const data = workbook([
    { name: "Resumo", ws: XLSX.utils.aoa_to_sheet([["Saldo", 1]]) },
    { name: "Pedro P", ws: creditorSheet("Pedro P", PEDRO) },
    { name: "Mylliano", ws: creditorSheet("Mylliano", []) },
  ]);
  const parsed = parseVbWorkbook(data);
  assert.deepEqual(parsed.ignoredSheets, ["Resumo"]);
  assert.deepEqual(parsed.emptySheets, ["Mylliano"]);
  assert.equal(parsed.creditors.length, 1);
  assert.equal(parsed.creditors[0].name, "Pedro P");
  assert.equal(parsed.creditors[0].sheetName, "Pedro P");
  assert.equal(parsed.creditors[0].hidden, false);
});

test("linhas viram lançamentos com sinal, período, taxa e método", () => {
  const [pedro] = parseVbWorkbook(workbook([{ name: "Pedro P", ws: creditorSheet("Pedro P", PEDRO) }])).creditors;
  const [aporte, rend1, resgate, rend2] = pedro.entries;

  assert.equal(pedro.entries.length, 4);
  assert.deepEqual(
    { kind: aporte.kind, amount: aporte.amount, date: aporte.entryDate, sort: aporte.sortOrder, row: aporte.sourceRow },
    { kind: "entrada", amount: 40000, date: "2017-08-07", sort: 51, row: 5 },
  );
  assert.deepEqual(
    { kind: rend1.kind, amount: rend1.amount, start: rend1.periodStart, end: rend1.periodEnd, days: rend1.days, rate: rend1.rate, basis: rend1.rateBasis, sort: rend1.sortOrder },
    { kind: "rendimento", amount: 3613.9, start: "2017-08-08", end: "2018-05-01", days: 266, rate: 0.01, basis: "mensal", sort: 60 },
  );
  assert.deepEqual({ kind: resgate.kind, amount: resgate.amount }, { kind: "saida", amount: -37000 });
  assert.equal(rend2.rateBasis, "periodo");
  assert.equal(rend2.amount, 221.57);
  assert.equal(rend1.description, "RENDIMENTO");
  assert.equal(aporte.sheetBalance, 40000);
  assert.deepEqual(aporte.flags, []);
});

test("saldo da planilha × saldo somado", () => {
  const [pedro] = parseVbWorkbook(workbook([{ name: "Pedro P", ws: creditorSheet("Pedro P", PEDRO) }])).creditors;
  assert.equal(pedro.sheetFinalBalance, 6835.4603);
  assert.equal(pedro.computedFinalBalance, 6835.47);
  assert.equal(pedro.diff, 0.01);
  assert.equal(pedro.blockingCount, 0);
  assert.equal(pedro.warningCount, 0);
});

test("movimento e rendimento na mesma linha → dois lançamentos, rendimento primeiro", () => {
  const rows: RowSpec[] = [
    { a: "2020-09-01", b: "2020-09-01", d: "APORTE", e: 30000, h: 30000 },
    { a: "2020-09-02", b: "2020-10-20", c: 48, d: "DEPOSITO CONTA BB", f: 5000, g: 1398.4047, gFormula: "FV(J6,C6,0,-H5)-H5", h: 26398.4047, i: 0.0038 },
  ];
  const [c] = parseVbWorkbook(workbook([{ name: "Renato", ws: creditorSheet("Renato", rows) }])).creditors;
  assert.equal(c.entries.length, 3);
  assert.deepEqual(c.entries.map((e) => [e.kind, e.sortOrder]), [["entrada", 51], ["rendimento", 60], ["saida", 62]]);
  assert.equal(c.entries[1].sheetBalance, null);
  assert.equal(c.entries[2].sheetBalance, 26398.4047);
  assert.equal(c.entries[1].description, "DEPOSITO CONTA BB");
});

test("data B inválida usa A; as duas inválidas → data_invalida (bloqueante) com a data anterior", () => {
  const rows: RowSpec[] = [
    { a: "2024-06-11", b: "2024-06-11", d: "APORTE", e: 100, h: 100 },
    { a: 1, b: "2024-07-01", d: "PLR", e: 50, h: 150 },          // A = 01/01/1900, B válida
    { a: 1, b: null, d: "SAQUE", f: 20, h: 130 },                // nenhuma válida
  ];
  const [c] = parseVbWorkbook(workbook([{ name: "Maria Ap", ws: creditorSheet("Maria Ap", rows) }])).creditors;
  assert.equal(c.entries[1].entryDate, "2024-07-01");
  assert.deepEqual(c.entries[1].flags, []);
  assert.equal(c.entries[2].entryDate, "2024-07-01");
  assert.deepEqual(c.entries[2].flags, ["data_invalida"]);
  assert.equal(c.blockingCount, 1);
});

test("período do rendimento: A inválida ou A > B → inferido do lançamento anterior", () => {
  const rows: RowSpec[] = [
    { a: "2021-06-01", b: "2021-06-30", d: "RENDIMENTO", g: 10, gFormula: "FV(J5,C5,0,-H4)-H4", h: 10, i: 0.005 },
    { a: 1, b: "2021-07-31", c: 30, d: "RENDIMENTO", g: 10, h: 20, i: 0.005 },
    { a: "2021-09-01", b: "2021-08-15", c: -17, d: "RENDIMENTO", g: -5, h: 15, i: 0.005 },
  ];
  const [c] = parseVbWorkbook(workbook([{ name: "Mirai", ws: creditorSheet("Mirai", rows) }])).creditors;
  assert.deepEqual([c.entries[1].periodStart, c.entries[1].periodEnd, c.entries[1].days], ["2021-07-01", "2021-07-31", 30]);
  assert.deepEqual(c.entries[1].flags, ["periodo_inferido"]);
  // A > B: começa no dia seguinte ao anterior (01/08), termina em 15/08
  assert.deepEqual([c.entries[2].periodStart, c.entries[2].periodEnd, c.entries[2].days], ["2021-08-01", "2021-08-15", 14]);
  assert.ok(c.entries[2].flags.includes("periodo_inferido"));
  assert.ok(c.entries[2].flags.includes("dias_divergentes"));
  assert.equal(c.entries[2].rateBasis, "ajuste"); // sem fórmula
});

test("avisos: conferir, sem descrição, entrada e saída juntas, fora de ordem; rendimento zero é pulado", () => {
  const rows: RowSpec[] = [
    { a: "2023-02-23", b: "2023-02-23", d: "VENDA APTO CONFERIR VALOR", e: 915000, h: 915000 },
    { a: "2023-02-24", b: "2023-02-24", e: 10, f: 5, h: 915005 },
    { a: "2023-02-25", b: "2023-03-01", c: 5, d: "RENDIMENTO", g: 0.001, h: 915005 },
    { a: "2023-03-02", b: "2023-03-02", d: "OK", h: 915005 },
    { a: "2023-02-20", b: "2023-02-20", d: "ATRASADO", e: 1, h: 915006 },
  ];
  const [c] = parseVbWorkbook(workbook([{ name: "Renato", ws: creditorSheet("Renato", rows) }])).creditors;
  assert.deepEqual(c.entries[0].flags, ["conferir"]);
  assert.deepEqual(c.entries[1].flags, ["entrada_e_saida", "sem_descricao"]);
  assert.equal(c.entries[1].description, "(sem descrição)");
  assert.deepEqual(c.entries[2].flags, ["entrada_e_saida", "sem_descricao"]);
  assert.deepEqual(c.entries[3].flags, ["fora_de_ordem"]);
  assert.equal(c.entries.length, 4);
  assert.deepEqual(c.skippedRows, [
    { row: 7, reason: "rendimento_zero" },
    { row: 8, reason: "linha_sem_valor" },
  ]);
  assert.equal(c.warningCount, 4);
});

test("célula de erro (#REF!) em RENDIMENTO → valor_invalido, bloqueante", () => {
  const rows: RowSpec[] = [
    { a: "2024-01-01", b: "2024-01-01", d: "APORTE", e: 100, h: 100 },
    { a: "2024-01-02", b: "2024-01-31", d: "RENDIMENTO", gError: true, h: 100 },
  ];
  const [c] = parseVbWorkbook(workbook([{ name: "X", ws: creditorSheet("X", rows) }])).creditors;
  assert.equal(c.entries[1].kind, "rendimento");
  assert.equal(c.entries[1].amount, 0);
  assert.deepEqual(c.entries[1].flags, ["valor_invalido"]);
  assert.equal(c.blockingCount, 1);
});

test("aba oculta → hidden true; nome vem de A1, com fallback no nome da aba", () => {
  const ws = creditorSheet("Fabio", [{ a: "2017-02-23", b: "2017-02-23", d: "APORTE", e: 15000, h: 15000 }]);
  const noName = creditorSheet("", [{ a: "2017-02-23", b: "2017-02-23", d: "APORTE", e: 1, h: 1 }]);
  delete noName.A1;
  const parsed = parseVbWorkbook(workbook([
    { name: "Fabio", ws, hidden: true },
    { name: "Renan", ws: noName },
  ]));
  assert.equal(parsed.creditors[0].hidden, true);
  assert.equal(parsed.creditors[1].name, "Renan");
  assert.equal(parsed.creditors[1].hidden, false);
});

test("arquivo que não é planilha lança", () => {
  assert.throws(() => parseVbWorkbook(new Uint8Array([1, 2, 3, 4])));
});
```

- [ ] **Step 8: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/vb/import/parse-vb-workbook'`.

- [ ] **Step 9: Implementar `src/lib/vb/import/parse-vb-workbook.ts`**

```ts
// Parser da planilha VB ("VB TERRAZZO"). Função pura: recebe os bytes do .xlsx
// e devolve, por aba de credor, os lançamentos já classificados e com alertas.
// Não toca banco nem sessão — o route handler de importação e o script
// scripts/vb-parse-check.ts consomem o resultado.
//
// Layout de cada aba de credor (ver docs/superpowers/specs/2026-09-09-vb-viva-bank-design.md §6):
//   A1 = nome do credor
//   linha 4 = DATA | DATA | DIAS | DESCRIÇÃO | ENTRADA | SAÍDA | RENDIMENTO | SALDO | TX
//   linha 5+ = lançamentos. A = início do período (fórmula =B(anterior)+1 na
//   maioria das linhas → 01/01/1900 quando aponta célula vazia), B = data
//   lançada / fim do período, G = rendimento (fórmula FV → taxa mensal
//   capitalizada por dia; H*I → saldo × taxa do período; literal → ajuste).

import * as XLSX from "xlsx";

import { addDaysIso, diffDaysIso, excelSerialToIsoDate } from "@/lib/vb/import/excel-date";
import { fromCents, roundCents, sumCents } from "@/lib/vb/money";
import { isBlockingFlag, type VbEntryFlag, type VbEntryKind, type VbRateBasis } from "@/lib/vb/types";

export interface ParsedEntry {
  sourceRow: number;
  /** linha × 10 + sub (0 rendimento, 1 entrada, 2 saída) — ordem da planilha. */
  sortOrder: number;
  entryDate: string;
  kind: VbEntryKind;
  amount: number;
  description: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  days: number | null;
  rate: number | null;
  rateBasis: VbRateBasis | null;
  /** SALDO da planilha na linha; só no último lançamento gerado pela linha. */
  sheetBalance: number | null;
  flags: VbEntryFlag[];
}

export interface SkippedRow {
  row: number;
  reason: "linha_sem_valor" | "rendimento_zero";
}

export interface ParsedCreditor {
  sheetName: string;
  name: string;
  hidden: boolean;
  entries: ParsedEntry[];
  skippedRows: SkippedRow[];
  sheetFinalBalance: number | null;
  computedFinalBalance: number;
  diff: number | null;
  blockingCount: number;
  warningCount: number;
}

export interface ParsedWorkbook {
  creditors: ParsedCreditor[];
  emptySheets: string[];
  ignoredSheets: string[];
}

const HEADER_ROW = 4;
const FIRST_DATA_ROW = 5;
const EXPECTED_HEADERS = ["DATA", "DATA", "DIAS", "DESCRICAO", "ENTRADA", "SAIDA", "RENDIMENTO", "SALDO"];
const HEADER_COLS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const COL = {
  start: "A",
  end: "B",
  days: "C",
  desc: "D",
  in: "E",
  out: "F",
  yield: "G",
  balance: "H",
  rate: "I",
} as const;
/** Sem nenhuma data válida e sem lançamento anterior; o gestor corrige na revisão. */
const FALLBACK_DATE = "1900-01-01";

type Cell = XLSX.CellObject | undefined;

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function cellAt(ws: XLSX.WorkSheet, col: string, row: number): Cell {
  return ws[`${col}${row}`] as Cell;
}

function numberOf(cell: Cell): number | null {
  if (!cell || cell.t !== "n") return null;
  return typeof cell.v === "number" && Number.isFinite(cell.v) ? cell.v : null;
}

function isErrorCell(cell: Cell): boolean {
  return Boolean(cell && cell.t === "e");
}

function textOf(cell: Cell): string | null {
  if (!cell || cell.v == null) return null;
  const s = String(cell.v).trim();
  return s.length > 0 ? s : null;
}

function isCreditorSheet(ws: XLSX.WorkSheet): boolean {
  return HEADER_COLS.every(
    (col, i) => normalizeHeader(cellAt(ws, col, HEADER_ROW)?.v) === EXPECTED_HEADERS[i],
  );
}

function isHiddenSheet(wb: XLSX.WorkBook, sheetName: string): boolean {
  const meta = wb.Workbook?.Sheets?.find((s) => s.name === sheetName);
  return (meta?.Hidden ?? 0) !== 0;
}

function lastRow(ws: XLSX.WorkSheet): number {
  const ref = ws["!ref"];
  if (!ref) return 0;
  return XLSX.utils.decode_range(ref).e.r + 1;
}

/** Método do juro pela fórmula de G. Sem fórmula (valor digitado) = ajuste. */
function rateBasisFromFormula(formula: string | undefined): VbRateBasis {
  if (!formula) return "ajuste";
  const f = formula.replace(/\$/g, "").replace(/\s+/g, "").toUpperCase();
  if (/FV\(/.test(f)) return "mensal";
  if (/^[A-Z]{1,2}\d+\*[A-Z]{1,2}\d+$/.test(f)) return "periodo";
  return "ajuste";
}

function parseCreditorSheet(wb: XLSX.WorkBook, sheetName: string): ParsedCreditor | null {
  const ws = wb.Sheets[sheetName];
  const name = textOf(cellAt(ws, "A", 1)) ?? sheetName;
  const entries: ParsedEntry[] = [];
  const skippedRows: SkippedRow[] = [];
  let sheetFinalBalance: number | null = null;
  // Data do último lançamento em ordem de planilha: fecha o período do próximo
  // rendimento quando A é inválida e detecta linhas fora de ordem.
  let prevDate: string | null = null;
  const end = lastRow(ws);

  for (let row = FIRST_DATA_ROW; row <= end; row++) {
    const desc = textOf(cellAt(ws, COL.desc, row));
    const inCell = cellAt(ws, COL.in, row);
    const outCell = cellAt(ws, COL.out, row);
    const yieldCell = cellAt(ws, COL.yield, row);
    const inVal = numberOf(inCell) ?? 0;
    const outVal = numberOf(outCell) ?? 0;
    const yieldVal = numberOf(yieldCell) ?? 0;
    const anyError = isErrorCell(inCell) || isErrorCell(outCell) || isErrorCell(yieldCell);

    // Linha real vs. preenchimento vazio da planilha (A=anterior+1, C=-1, H=anterior).
    const isReal = desc !== null || inVal !== 0 || outVal !== 0 || yieldVal !== 0 || anyError;
    if (!isReal) continue;

    const balance = numberOf(cellAt(ws, COL.balance, row));
    if (balance !== null) sheetFinalBalance = balance;

    const endDate = excelSerialToIsoDate(cellAt(ws, COL.end, row)?.v);
    const startDate = excelSerialToIsoDate(cellAt(ws, COL.start, row)?.v);
    const rowFlags: VbEntryFlag[] = [];
    let entryDate = endDate ?? startDate;
    let dateInvalid = false;
    if (!entryDate) {
      entryDate = prevDate ?? FALLBACK_DATE;
      dateInvalid = true;
      rowFlags.push("data_invalida");
    }
    if (!dateInvalid && prevDate && entryDate < prevDate) rowFlags.push("fora_de_ordem");
    if (desc && /CONFERIR/i.test(desc)) rowFlags.push("conferir");

    const rowEntries: ParsedEntry[] = [];

    // ── Rendimento ──────────────────────────────────────────────────────
    // Qualquer G ≠ 0 conta; o que arredonda para 0,00 é pulado como rendimento_zero.
    const hasYield = isErrorCell(yieldCell) || yieldVal !== 0;
    if (hasYield) {
      const amount = isErrorCell(yieldCell) ? 0 : roundCents(yieldVal);
      if (!isErrorCell(yieldCell) && amount === 0) {
        skippedRows.push({ row, reason: "rendimento_zero" });
      } else {
        const flags: VbEntryFlag[] = [...rowFlags];
        if (isErrorCell(yieldCell)) flags.push("valor_invalido");
        let periodStart: string;
        if (startDate && startDate <= entryDate) {
          periodStart = startDate;
        } else {
          const candidate = prevDate ? addDaysIso(prevDate, 1) : entryDate;
          periodStart = candidate <= entryDate ? candidate : entryDate;
          flags.push("periodo_inferido");
        }
        const days = diffDaysIso(periodStart, entryDate);
        const sheetDays = numberOf(cellAt(ws, COL.days, row));
        if (sheetDays !== null && Math.round(sheetDays) !== days) flags.push("dias_divergentes");
        rowEntries.push({
          sourceRow: row,
          sortOrder: row * 10,
          entryDate,
          kind: "rendimento",
          amount,
          description: desc ?? "Rendimento",
          periodStart,
          periodEnd: entryDate,
          days,
          rate: numberOf(cellAt(ws, COL.rate, row)),
          rateBasis: rateBasisFromFormula(yieldCell?.f),
          sheetBalance: null,
          flags,
        });
      }
    }

    // ── Movimentos ──────────────────────────────────────────────────────
    const movementFlags: VbEntryFlag[] = [...rowFlags];
    const hasIn = inVal !== 0 || isErrorCell(inCell);
    const hasOut = outVal !== 0 || isErrorCell(outCell);
    if (hasIn && hasOut) movementFlags.push("entrada_e_saida");
    if ((hasIn || hasOut) && !desc) movementFlags.push("sem_descricao");
    const movementDesc = desc ?? "(sem descrição)";

    if (hasIn) {
      const amount = isErrorCell(inCell) ? 0 : roundCents(inVal);
      const flags: VbEntryFlag[] = [...movementFlags];
      if (isErrorCell(inCell) || amount <= 0) flags.push("valor_invalido");
      rowEntries.push({
        sourceRow: row,
        sortOrder: row * 10 + 1,
        entryDate,
        kind: "entrada",
        amount,
        description: movementDesc,
        periodStart: null,
        periodEnd: null,
        days: null,
        rate: null,
        rateBasis: null,
        sheetBalance: null,
        flags,
      });
    }
    if (hasOut) {
      const amount = isErrorCell(outCell) ? 0 : -roundCents(outVal);
      const flags: VbEntryFlag[] = [...movementFlags];
      if (isErrorCell(outCell) || amount >= 0) flags.push("valor_invalido");
      rowEntries.push({
        sourceRow: row,
        sortOrder: row * 10 + 2,
        entryDate,
        kind: "saida",
        amount,
        description: movementDesc,
        periodStart: null,
        periodEnd: null,
        days: null,
        rate: null,
        rateBasis: null,
        sheetBalance: null,
        flags,
      });
    }

    if (rowEntries.length === 0) {
      if (!hasYield) skippedRows.push({ row, reason: "linha_sem_valor" });
    } else {
      rowEntries[rowEntries.length - 1].sheetBalance = balance;
      entries.push(...rowEntries);
    }
    if (!dateInvalid) prevDate = entryDate;
  }

  if (entries.length === 0 && skippedRows.length === 0) return null;

  const computedFinalBalance = fromCents(sumCents(entries.map((e) => e.amount)));
  const diff = sheetFinalBalance === null ? null : roundCents(computedFinalBalance - sheetFinalBalance);
  const blockingCount = entries.filter((e) => e.flags.some(isBlockingFlag)).length;
  const warningCount = entries.filter(
    (e) => e.flags.length > 0 && !e.flags.some(isBlockingFlag),
  ).length;

  return {
    sheetName,
    name,
    hidden: isHiddenSheet(wb, sheetName),
    entries,
    skippedRows,
    sheetFinalBalance,
    computedFinalBalance,
    diff,
    blockingCount,
    warningCount,
  };
}

/**
 * Lê o .xlsx inteiro. Lança só quando o arquivo não é uma planilha legível;
 * problema de conteúdo vira flag no lançamento, nunca exceção.
 */
export function parseVbWorkbook(data: Uint8Array): ParsedWorkbook {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(data, { type: "array", cellDates: false });
  } catch {
    throw new Error("Arquivo inválido: não é uma planilha .xlsx legível.");
  }
  if (!wb.SheetNames || wb.SheetNames.length === 0) {
    throw new Error("Arquivo inválido: planilha sem abas.");
  }
  const result: ParsedWorkbook = { creditors: [], emptySheets: [], ignoredSheets: [] };

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws || !isCreditorSheet(ws)) {
      result.ignoredSheets.push(sheetName);
      continue;
    }
    const creditor = parseCreditorSheet(wb, sheetName);
    if (!creditor) {
      result.emptySheets.push(sheetName);
      continue;
    }
    result.creditors.push(creditor);
  }

  return result;
}
```

- [ ] **Step 10: Rodar e ver passar**

Run: `npm test`
Expected: todos os testes do parser passam. Se `XLSX.read` reclamar do tipo do buffer no teste, confirmar que o teste passa `new Uint8Array(XLSX.write(..., { type: "buffer" }))` — o parser usa `type: "array"` e aceita `Uint8Array`/`Buffer`.

- [ ] **Step 11: Script de conferência com a planilha real**

Criar `scripts/vb-parse-check.ts`:

```ts
// Confere o parser do VB contra a planilha real (sem tocar o banco):
//
//   npx tsx scripts/vb-parse-check.ts ["docs/VB TERRAZZO V2.xlsx"]
//
// Imprime, por credor, lançamentos, saldo da planilha × saldo somado, diferença
// e alertas. Sai com código 1 se algum credor estourar a tolerância de
// arredondamento (VB_BALANCE_TOLERANCE) ou tiver alerta bloqueante.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseVbWorkbook } from "../src/lib/vb/import/parse-vb-workbook";
import { VB_BALANCE_TOLERANCE, isBlockingFlag } from "../src/lib/vb/types";

const file = resolve(process.argv[2] ?? "docs/VB TERRAZZO V2.xlsx");
const parsed = parseVbWorkbook(new Uint8Array(readFileSync(file)));

const brl = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let failed = false;
console.log(`Arquivo: ${file}`);
console.log(`Abas ignoradas: ${parsed.ignoredSheets.join(", ") || "—"}`);
console.log(`Abas vazias: ${parsed.emptySheets.join(", ") || "—"}`);
console.log("");

for (const c of parsed.creditors) {
  const flagCounts = new Map<string, number>();
  for (const e of c.entries) for (const f of e.flags) flagCounts.set(f, (flagCounts.get(f) ?? 0) + 1);
  const flags = Array.from(flagCounts.entries()).map(([f, n]) => `${f}×${n}${isBlockingFlag(f) ? "!" : ""}`).join(" ");
  const overTolerance = c.diff !== null && Math.abs(c.diff) > VB_BALANCE_TOLERANCE;
  if (overTolerance || c.blockingCount > 0) failed = true;
  console.log(
    `${c.name.padEnd(22)} ${c.hidden ? "(oculta) " : "         "}` +
      `lanç=${String(c.entries.length).padStart(4)} puladas=${String(c.skippedRows.length).padStart(2)} ` +
      `planilha=${brl(c.sheetFinalBalance).padStart(14)} sistema=${brl(c.computedFinalBalance).padStart(14)} ` +
      `diff=${brl(c.diff).padStart(8)}${overTolerance ? " !!" : "   "} ${flags}`,
  );
}

const total = parsed.creditors.filter((c) => !c.hidden).reduce((acc, c) => acc + c.computedFinalBalance, 0);
console.log("");
console.log(`Saldo total (abas visíveis): ${brl(total)}`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 12: Rodar o script**

Run: `npx tsx scripts/vb-parse-check.ts`
Expected: 9 credores (Fabio, Mirai, Renan marcados `(oculta)`), aba vazia `Mylliano`, 4 ignoradas (Resumo, dividendos 2024, Propostas socios 2026, Propostas socios 2025, Imoveis — são 5 nomes; conferir a lista impressa), `|diff| ≤ 0,05` em todos, nenhuma flag com `!`, saldo total ≈ 2.368.211,67 e código de saída 0. Se aparecer `data_invalida`, investigar a linha (a coluna B da planilha real é sempre válida nas linhas reais — foi conferido em 09/09/2026).

- [ ] **Step 13: Lint e commit**

```bash
npm run lint
git add src/lib/vb/money.ts src/lib/vb/money.test.ts src/lib/vb/import scripts/vb-parse-check.ts
git commit -m "feat(vb): parser da planilha VB com alertas e conferência de saldo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Matemática do extrato e formatação do rendimento

**Files:**
- Create: `src/lib/vb/ledger.ts`
- Create: `src/lib/vb/ledger.test.ts`
- Create: `src/lib/vb/format.ts`
- Create: `src/lib/vb/format.test.ts`

**Interfaces:**
- Consumes: `toCents`, `fromCents`, `sumCents` (Task 4); `VbEntry` (Task 1); `formatDayBR` (`@/lib/ctrl/datetime`).
- Produces: `LedgerEntryLike`, `compareLedger`, `sortLedger`, `withRunningBalance(entries, opening?)`, `withSheetOrderBalance(entries)`, `ledgerTotals(entries): LedgerTotals { entradas, saidas, rendimentos, saldo }`, `currentBalance(entries)`, `groupByYear(entries): YearGroup[]`, `yieldOf(entries, year)`, `yieldBySemester(entries, years): SemesterYield[]`; `formatPercent(rate, digits?)`, `describeRendimento(entry)`.

- [ ] **Step 1: Teste do ledger (falha)**

Criar `src/lib/vb/ledger.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  currentBalance,
  groupByYear,
  ledgerTotals,
  sortLedger,
  withRunningBalance,
  withSheetOrderBalance,
  yieldBySemester,
  yieldOf,
  type LedgerEntryLike,
} from "@/lib/vb/ledger";

function e(
  id: string,
  entry_date: string,
  kind: LedgerEntryLike["kind"],
  amount: number,
  sort_order = 0,
  created_at = "2026-09-09T00:00:00Z",
): LedgerEntryLike {
  return { id, entry_date, kind, amount, sort_order, created_at };
}

const ENTRIES = [
  e("r1", "2025-07-01", "rendimento", 100.5, 60),
  e("a1", "2025-01-10", "entrada", 1000, 51),
  e("s1", "2025-07-01", "saida", -200, 62),
  e("r2", "2026-03-31", "rendimento", 30.25, 70),
  e("m1", "2025-07-01", "entrada", 50, 0, "2026-09-10T00:00:00Z"),
];

test("sortLedger: data, depois sort_order, depois created_at", () => {
  assert.deepEqual(sortLedger(ENTRIES).map((x) => x.id), ["a1", "m1", "r1", "s1", "r2"]);
});

test("withRunningBalance acumula em centavos e aceita saldo de abertura", () => {
  const rows = withRunningBalance(ENTRIES);
  assert.deepEqual(rows.map((r) => [r.id, r.balance]), [
    ["a1", 1000],
    ["m1", 1050],
    ["r1", 1150.5],
    ["s1", 950.5],
    ["r2", 980.75],
  ]);
  assert.equal(withRunningBalance([e("x", "2026-01-01", "entrada", 0.1)], 0.2)[0].balance, 0.3);
});

test("withSheetOrderBalance usa a ordem da planilha (sort_order), não a data", () => {
  const rows = withSheetOrderBalance([
    e("b", "2023-07-20", "saida", -10, 620),
    e("a", "2023-09-13", "rendimento", 5, 630),
    e("z", "2023-01-01", "entrada", 100, 50),
  ]);
  assert.deepEqual(rows.map((r) => [r.id, r.balance]), [["z", 100], ["b", 90], ["a", 95]]);
});

test("ledgerTotals: saídas em módulo, rendimentos com sinal, saldo = soma", () => {
  assert.deepEqual(ledgerTotals(ENTRIES), { entradas: 1050, saidas: 200, rendimentos: 130.75, saldo: 980.75 });
  assert.equal(currentBalance(ENTRIES), 980.75);
  assert.deepEqual(ledgerTotals([]), { entradas: 0, saidas: 0, rendimentos: 0, saldo: 0 });
});

test("groupByYear: anos do mais recente ao mais antigo, saldo de fechamento acumulado", () => {
  const groups = groupByYear(ENTRIES);
  assert.deepEqual(groups.map((g) => g.year), [2026, 2025]);
  assert.equal(groups[1].closingBalance, 950.5);
  assert.equal(groups[0].closingBalance, 980.75);
  assert.deepEqual(groups[1].entries.map((x) => x.id), ["a1", "m1", "r1", "s1"]);
  assert.equal(groups[1].totals.rendimentos, 100.5);
  assert.equal(groups[0].entries[0].balance, 980.75);
});

test("yieldOf e yieldBySemester", () => {
  assert.equal(yieldOf(ENTRIES, 2025), 100.5);
  assert.equal(yieldOf(ENTRIES, 2024), 0);
  assert.deepEqual(yieldBySemester(ENTRIES, [2025, 2026]), [
    { year: 2025, semester: 1, total: 0 },
    { year: 2025, semester: 2, total: 100.5 },
    { year: 2026, semester: 1, total: 30.25 },
    { year: 2026, semester: 2, total: 0 },
  ]);
});
```

- [ ] **Step 2: Implementar `src/lib/vb/ledger.ts`**

```ts
// Matemática do extrato do VB. Tudo em centavos inteiros (ver money.ts). O
// saldo nunca é gravado no banco: é sempre recomputado daqui.

import { fromCents, sumCents, toCents } from "@/lib/vb/money";
import type { VbEntry } from "@/lib/vb/types";

export type LedgerEntryLike = Pick<
  VbEntry,
  "id" | "entry_date" | "sort_order" | "created_at" | "kind" | "amount"
>;

export type WithBalance<T> = T & { balance: number };

export interface LedgerTotals {
  entradas: number;
  /** Em módulo (positivo). */
  saidas: number;
  /** Com sinal — há rendimentos negativos (ajustes). */
  rendimentos: number;
  saldo: number;
}

export interface YearGroup<T extends LedgerEntryLike> {
  year: number;
  entries: WithBalance<T>[];
  totals: LedgerTotals;
  closingBalance: number;
}

export interface SemesterYield {
  year: number;
  semester: 1 | 2;
  total: number;
}

/** Ordem cronológica: data, depois ordem da planilha, depois criação. */
export function compareLedger(a: LedgerEntryLike, b: LedgerEntryLike): number {
  if (a.entry_date !== b.entry_date) return a.entry_date < b.entry_date ? -1 : 1;
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return 0;
}

export function sortLedger<T extends LedgerEntryLike>(entries: readonly T[]): T[] {
  return [...entries].sort(compareLedger);
}

function accumulate<T extends LedgerEntryLike>(ordered: T[], openingCents: number): WithBalance<T>[] {
  let cents = openingCents;
  return ordered.map((entry) => {
    cents += toCents(entry.amount);
    return { ...entry, balance: fromCents(cents) };
  });
}

/** Saldo corrente em ordem cronológica. */
export function withRunningBalance<T extends LedgerEntryLike>(
  entries: readonly T[],
  opening = 0,
): WithBalance<T>[] {
  return accumulate(sortLedger(entries), toCents(opening));
}

/**
 * Saldo em ordem de PLANILHA (sort_order). Usado só na revisão da importação,
 * para bater linha a linha com a coluna SALDO — a planilha tem datas fora de
 * ordem e o saldo dela segue a posição da linha.
 */
export function withSheetOrderBalance<T extends LedgerEntryLike>(
  entries: readonly T[],
): WithBalance<T>[] {
  const ordered = [...entries].sort((a, b) => a.sort_order - b.sort_order || compareLedger(a, b));
  return accumulate(ordered, 0);
}

export function ledgerTotals(entries: readonly LedgerEntryLike[]): LedgerTotals {
  let entradas = 0;
  let saidas = 0;
  let rendimentos = 0;
  for (const entry of entries) {
    const cents = toCents(entry.amount);
    if (entry.kind === "entrada") entradas += cents;
    else if (entry.kind === "saida") saidas += Math.abs(cents);
    else rendimentos += cents;
  }
  return {
    entradas: fromCents(entradas),
    saidas: fromCents(saidas),
    rendimentos: fromCents(rendimentos),
    saldo: fromCents(sumCents(entries.map((e) => e.amount))),
  };
}

export function currentBalance(entries: readonly LedgerEntryLike[]): number {
  return fromCents(sumCents(entries.map((e) => e.amount)));
}

function yearOf(entry: LedgerEntryLike): number {
  return Number(entry.entry_date.slice(0, 4));
}

/** Anos do mais recente ao mais antigo; dentro do ano, ordem cronológica. */
export function groupByYear<T extends LedgerEntryLike>(entries: readonly T[]): YearGroup<T>[] {
  const withBalance = withRunningBalance(entries);
  const byYear = new Map<number, WithBalance<T>[]>();
  for (const entry of withBalance) {
    const year = yearOf(entry);
    const list = byYear.get(year) ?? [];
    list.push(entry);
    byYear.set(year, list);
  }
  // Array.from, não spread: o tsconfig não tem downlevelIteration (padrão do repo).
  return Array.from(byYear.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([year, list]) => ({
      year,
      entries: list,
      totals: ledgerTotals(list),
      closingBalance: list[list.length - 1].balance,
    }));
}

export function yieldOf(entries: readonly LedgerEntryLike[], year: number): number {
  return fromCents(
    sumCents(entries.filter((e) => e.kind === "rendimento" && yearOf(e) === year).map((e) => e.amount)),
  );
}

export function yieldBySemester(
  entries: readonly LedgerEntryLike[],
  years: readonly number[],
): SemesterYield[] {
  const out: SemesterYield[] = [];
  for (const year of years) {
    for (const semester of [1, 2] as const) {
      const total = fromCents(
        sumCents(
          entries
            .filter((e) => {
              if (e.kind !== "rendimento" || yearOf(e) !== year) return false;
              const month = Number(e.entry_date.slice(5, 7));
              return semester === 1 ? month <= 6 : month >= 7;
            })
            .map((e) => e.amount),
        ),
      );
      out.push({ year, semester, total });
    }
  }
  return out;
}
```

- [ ] **Step 3: Rodar e ver passar**

Run: `npm test`
Expected: testes do ledger passam.

- [ ] **Step 4: Teste do formato (falha)**

Criar `src/lib/vb/format.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { describeRendimento, formatPercent } from "@/lib/vb/format";

test("formatPercent em pt-BR", () => {
  assert.equal(formatPercent(0.0335), "3,35%");
  assert.equal(formatPercent(0.0075), "0,75%");
  assert.equal(formatPercent(0.148), "14,80%");
});

test("describeRendimento: período, dias e taxa por método", () => {
  assert.equal(
    describeRendimento({ period_start: "2026-01-01", period_end: "2026-03-31", days: 89, rate: 0.0335, rate_basis: "periodo" }),
    "01/01/2026 a 31/03/2026 · 89 dias · 3,35% no período",
  );
  assert.equal(
    describeRendimento({ period_start: "2017-08-08", period_end: "2018-05-01", days: 266, rate: 0.01, rate_basis: "mensal" }),
    "08/08/2017 a 01/05/2018 · 266 dias · 1,00% a.m.",
  );
  assert.equal(
    describeRendimento({ period_start: "2022-01-02", period_end: "2023-09-05", days: 611, rate: null, rate_basis: "ajuste" }),
    "02/01/2022 a 05/09/2023 · 611 dias · ajuste manual",
  );
  assert.equal(
    describeRendimento({ period_start: "2026-07-01", period_end: "2026-07-01", days: 0, rate: 0.001, rate_basis: "cdi" }),
    "01/07/2026 · 0 dias · 0,10% (CDI)",
  );
  assert.equal(describeRendimento({ period_start: null, period_end: null, days: null, rate: null, rate_basis: null }), null);
  assert.equal(describeRendimento({ period_start: null, period_end: null, days: 1, rate: null, rate_basis: null }), "1 dia");
});
```

- [ ] **Step 5: Implementar `src/lib/vb/format.ts`**

```ts
// Textos do extrato do VB. Client-safe (só Intl e strings).

import { formatDayBR } from "@/lib/ctrl/datetime";
import type { VbEntry } from "@/lib/vb/types";

export function formatPercent(rate: number, digits = 2): string {
  const value = (rate * 100).toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${value}%`;
}

/**
 * Explicação do rendimento na linha do extrato:
 * "01/01/2026 a 31/03/2026 · 89 dias · 3,35% no período".
 */
export function describeRendimento(
  entry: Pick<VbEntry, "period_start" | "period_end" | "days" | "rate" | "rate_basis">,
): string | null {
  const parts: string[] = [];
  if (entry.period_start && entry.period_end) {
    parts.push(
      entry.period_start === entry.period_end
        ? formatDayBR(entry.period_end)
        : `${formatDayBR(entry.period_start)} a ${formatDayBR(entry.period_end)}`,
    );
  }
  if (entry.days != null) parts.push(`${entry.days} ${entry.days === 1 ? "dia" : "dias"}`);
  if (entry.rate_basis === "ajuste") {
    parts.push("ajuste manual");
  } else if (entry.rate != null) {
    if (entry.rate_basis === "mensal") parts.push(`${formatPercent(entry.rate)} a.m.`);
    else if (entry.rate_basis === "cdi") parts.push(`${formatPercent(entry.rate)} (CDI)`);
    else parts.push(`${formatPercent(entry.rate)} no período`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}
```

- [ ] **Step 6: Rodar e ver passar; lint; commit**

Run: `npm test && npm run lint`
Expected: tudo verde.

```bash
git add src/lib/vb/ledger.ts src/lib/vb/ledger.test.ts src/lib/vb/format.ts src/lib/vb/format.test.ts
git commit -m "feat(vb): saldo corrente, agrupamento por ano e descrição do rendimento

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Módulo no menu, route group `(vb)`, leituras e Visão geral

**Files:**
- Modify: `src/lib/context/active-context.ts`
- Modify: `src/lib/context/modules.ts`
- Modify: `src/components/app/navigation.ts`
- Modify: `src/components/app/nav-links.tsx`
- Modify: `src/components/app/app-shell.tsx`
- Modify: `src/app/(app)/layout.tsx`, `src/app/(ctrl)/ctrl/layout.tsx`, `src/app/(case)/case/layout.tsx`, `src/app/(viagens)/viagens/layout.tsx`
- Create: `src/app/(vb)/error.tsx`, `src/app/(vb)/vb/layout.tsx`, `src/app/(vb)/vb/loading.tsx`, `src/app/(vb)/vb/page.tsx`
- Create: `src/lib/vb/queries.ts`

**Interfaces:**
- Consumes: `VB_PATH`, `VB_NAV_KEY_OVERVIEW`, `VB_NAV_KEY_IMPORT` (Task 2); `getVbUser` (Task 2); `listCreditors`, `listEntries`, `getPendingBatch` (este task); `currentBalance`, `sortLedger`, `yieldOf`, `yieldBySemester` (Task 5); `formatBRL` (`@/lib/orcamento/format`); `formatDayBR`, `currentYearBR` (`@/lib/ctrl/datetime`).
- Produces: `ActiveModule` inclui `"vb"`; `MODULES.vb`; `resolveLayoutContext(..., canViagens, canVb)`; prop `vbRole` em `AppShell` e `NavLinks`; `NavItem.vbAccess` / `NavItem.vbGestorOnly`; `NavGroupId` inclui `"vb"`; `src/lib/vb/queries.ts` com `VbDb`, `listCreditors(db)`, `getCreditor(db, id)`, `listEntries(db, { status, creditorId?, batchId? })`, `getPendingBatch(db)`, `listBatches(db)`, `getBatch(db, id)`, `countPendingEntries(db, creditorId)`.

- [ ] **Step 1: `active-context.ts`**

Trocar as duas linhas:

```ts
export type ActiveModule = "dre" | "ctrl" | "case" | "viagens" | "vb";

export const VALID_MODULES: readonly ActiveModule[] = ["dre", "ctrl", "case", "viagens", "vb"] as const;
```

- [ ] **Step 2: `modules.ts`**

1. Em `MODULES`, depois da entrada `viagens`, adicionar:

```ts
  vb: {
    id: "vb",
    label: "VB",
    usesSegments: false,
    defaultPath: "/vb",
  },
```

2. `MODULE_ORDER`:

```ts
export const MODULE_ORDER: readonly ActiveModule[] = ["dre", "ctrl", "case", "viagens", "vb"] as const;
```

3. `resolveAvailableModules` ganha o parâmetro `canVb?: boolean | null` depois de `canViagens` e a linha `if (canVb) result.push(MODULES.vb);` depois de `if (canViagens) ...`. Atualizar o comentário JSDoc com `- VB access if canVb is set (concessão em user_module_roles; admin não herda).`

4. `resolveLayoutContext` ganha `canVb?: boolean | null` depois de `canViagens?: boolean | null,` e passa adiante: `resolveAvailableModules(dreRole, ctrlRoles, canCase, canViagens, canVb)`.

- [ ] **Step 3: `navigation.ts`**

1. Imports: adicionar `Landmark` e `Upload` à lista de ícones do `lucide-react` (ordem alfabética) e:

```ts
import { VB_NAV_KEY_IMPORT, VB_NAV_KEY_OVERVIEW, VB_PATH } from "@/lib/auth/vb";
```

2. Em `NavItem`, depois de `biValidationAccess?: boolean;`:

```ts
  /**
   * Item do módulo VB (Viva Bank) — visível para quem tem a concessão (ver
   * @/lib/auth/vb). Independe de dreRoles/ctrlRoles; admin não herda.
   */
  vbAccess?: boolean;
  /** Item só do papel gestor do VB (importação). */
  vbGestorOnly?: boolean;
```

3. `NavGroupId`: adicionar `| "vb"` depois de `| "contratos"`.

4. Em `NAV_GROUPS`, entre o grupo `contratos` e o grupo `plataforma`:

```ts
  {
    // Módulo VB (Viva Bank): créditos de sócios/credores. Concedido por
    // usuário em user_module_roles (module='vb'); admin não enxerga sem a
    // linha — ver @/lib/auth/vb.
    id: "vb",
    label: "VB",
    items: [
      { key: VB_NAV_KEY_OVERVIEW, title: "Visão geral", icon: Landmark, scope: "global", href: VB_PATH, vbAccess: true },
      { key: VB_NAV_KEY_IMPORT, title: "Importação", icon: Upload, scope: "global", href: `${VB_PATH}/importar`, vbAccess: true, vbGestorOnly: true },
    ],
  },
```

- [ ] **Step 4: `nav-links.tsx`**

1. Import de tipo: trocar `import type { CtrlRole, DreRole, Segment } from "@/lib/supabase/types";` por `import type { CtrlRole, DreRole, Segment, VbRole } from "@/lib/supabase/types";`.

2. Em `NavLinksProps`, depois de `canContratos?: boolean;`:

```ts
  /** Papel no módulo VB (grupo VB); null sem concessão. */
  vbRole?: VbRole | null;
```

3. Em `BuildInput`, depois de `canContratos?: boolean;`: `vbRole?: VbRole | null;`.

4. Na desestruturação de `NavLinks({ ... })` adicionar `vbRole,` depois de `canContratos,` e na chamada `buildGroups({ ... })` adicionar `vbRole` depois de `canContratos`.

5. Em `buildGroups`, desestruturar `vbRole,` depois de `canContratos,` e na chamada `isItemVisible(...)` adicionar `vbRole ?? null` como último argumento.

6. Em `isItemVisible`, adicionar o último parâmetro `vbRole: VbRole | null = null,` depois de `ctrlFullView?: boolean,` e, logo depois de `if (item.contratosAccess) return canContratos;`:

```ts
  // VB (Viva Bank): módulo próprio, concedido por usuário. Não passa por
  // dreRole/ctrlRole nem pelas whitelists de franqueado/CSC; admin não herda.
  if (item.vbAccess) return vbRole !== null && (!item.vbGestorOnly || vbRole === "gestor");
```

7. Na checagem final `if (!item.dreRoles && !item.ctrlRoles && !item.caseAccess && !item.viagensAccess && !item.contratosAccess) return false;`, incluir `&& !item.vbAccess`.

- [ ] **Step 5: `app-shell.tsx`**

1. Import de tipo: adicionar `VbRole` à lista de `@/lib/supabase/types`.
2. Em `AppShellProps`, depois de `canContratos?: boolean;`:

```ts
  /** Papel no módulo VB (Viva Bank) — grupo VB no menu; null sem concessão. */
  vbRole?: VbRole | null;
```

3. Desestruturar `vbRole,` depois de `canContratos,` em `AppShell({ ... })`.
4. No `visibleNavKeys({ ... })` do `tourNavKeys`, adicionar `vbRole,` depois de `canContratos,` — e `vbRole,` também no array de dependências do `useMemo`, depois de `canContratos,`.
5. Em `<NavLinks ... canContratos={canContratos}` adicionar `vbRole={vbRole}` na linha seguinte.

- [ ] **Step 6: Os quatro layouts existentes**

Em cada um de `src/app/(app)/layout.tsx`, `src/app/(ctrl)/ctrl/layout.tsx`, `src/app/(case)/case/layout.tsx` e `src/app/(viagens)/viagens/layout.tsx`:

1. Logo depois da linha `const canContratos = Boolean(modules?.contratos);` (no `(app)`) ou `const canContratos = Boolean(modules.contratos);` (nos outros), adicionar:

```ts
  const vbRole = modules?.vb?.role ?? null;
```

(no `(ctrl)`, `(case)` e `(viagens)` a variável se chama `modules` sem `?.` — use `modules.vb?.role ?? null`).

2. Na chamada `resolveLayoutContext(...)`, adicionar `vbRole !== null,` como último argumento, depois de `canViagens,`.
3. No `<AppShell ...>`, adicionar `vbRole={vbRole}` na linha seguinte a `canContratos={canContratos}`.

- [ ] **Step 7: Route group `(vb)`**

Criar `src/app/(vb)/error.tsx` — cópia de `src/app/(case)/error.tsx` trocando `CaseError` por `VbError`, `"[case] Erro na rota:"` por `"[vb] Erro na rota:"` e `href="/case/contratos"` por `href="/vb"`.

Criar `src/app/(vb)/vb/loading.tsx`:

```tsx
import { GenericPageSkeleton } from "@/components/app/page-skeletons";

export default function Loading() {
  return <GenericPageSkeleton />;
}
```

Criar `src/app/(vb)/vb/layout.tsx`:

```tsx
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app/app-shell";
import { canAccessBiValidation } from "@/lib/auth/bi-validation";
import { getSessionContext } from "@/lib/auth/session";
import { resolveLayoutContext } from "@/lib/context/modules";
import { resolveUserSegments } from "@/lib/context/user-segments";
import { hasCtrlFullView } from "@/lib/ctrl/full-view";
import { getUnreadNotificationsCount } from "@/lib/ctrl/notifications";

/**
 * Layout do módulo VB (Viva Bank). Espelha o do (case): monta o AppShell e
 * barra quem não tem a concessão do módulo — inclusive admin (ver
 * @/lib/auth/vb).
 */
export default async function VbLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSessionContext();

  if (!ctx.user) redirect("/login");
  if (!ctx.modules?.vb) redirect("/");

  const { profile, supabase, modules } = ctx;
  const userName = profile?.name || ctx.user.email || "Usuario";
  const userEmail = profile?.email || ctx.user.email || "";
  const dreRole = modules.dre?.role ?? profile?.role ?? "gestor_unidade";
  const navDreRole = modules.dre?.role ?? null;
  const ctrlRoles = modules.ctrl?.roles ?? [];
  const canCase = Boolean(modules.case);
  const canViagens = Boolean(modules.viagens);
  const canViagensAprovar = Boolean(modules.viagens?.aprovador);
  const canContratos = Boolean(modules.contratos);
  const vbRole = modules.vb?.role ?? null;

  const segments = await resolveUserSegments(supabase, {
    isAdmin: dreRole === "admin",
    userId: profile?.id ?? null,
    companyIds: profile?.company_ids ?? [],
  });

  const { availableModules, activeModule, activeSegmentSlug } = await resolveLayoutContext(
    dreRole,
    ctrlRoles,
    segments,
    "vb",
    canCase,
    canViagens,
    vbRole !== null,
  );

  const unreadNotifications = profile?.id
    ? await getUnreadNotificationsCount(profile.id)
    : 0;

  return (
    <AppShell
      userName={userName}
      userEmail={userEmail}
      userRole={navDreRole}
      ctrlRoles={ctrlRoles}
      canCase={canCase}
      canViagens={canViagens}
      canViagensAprovar={canViagensAprovar}
      canContratos={canContratos}
      vbRole={vbRole}
      segments={segments}
      activeModule={activeModule}
      availableModules={availableModules}
      activeSegmentSlug={activeSegmentSlug}
      canBiValidation={canAccessBiValidation(profile)}
      ctrlFullView={ctrlRoles.length > 0 && hasCtrlFullView(userEmail)}
      unreadNotifications={unreadNotifications}
      userProfile={profile?.profile ?? null}
      tourSeen={profile?.tour_seen ?? false}
    >
      {children}
    </AppShell>
  );
}
```

- [ ] **Step 8: Leituras — `src/lib/vb/queries.ts`**

```ts
// Leituras do módulo VB. Recebem o client (do usuário → RLS; admin → service
// role) para que páginas e actions escolham o contexto. Lançam em erro de
// banco: a página cai no error.tsx do grupo.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  EMPTY_IMPORT_SUMMARY,
  type VbCreditor,
  type VbEntry,
  type VbEntryStatus,
  type VbImportBatch,
  type VbImportSummary,
} from "@/lib/vb/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type VbDb = SupabaseClient<any>;

/** PostgREST devolve no máximo 1000 linhas por requisição. */
const PAGE = 1000;

function normalizeEntry(row: Record<string, unknown>): VbEntry {
  return {
    ...(row as unknown as VbEntry),
    amount: Number(row.amount),
    rate: row.rate == null ? null : Number(row.rate),
    sheet_balance: row.sheet_balance == null ? null : Number(row.sheet_balance),
    flags: (row.flags as VbEntry["flags"] | null) ?? [],
  };
}

function normalizeBatch(row: Record<string, unknown>): VbImportBatch {
  const summary = row.summary as Partial<VbImportSummary> | null;
  return {
    ...(row as unknown as VbImportBatch),
    summary: { ...EMPTY_IMPORT_SUMMARY, ...(summary ?? {}) },
  };
}

export async function listCreditors(db: VbDb): Promise<VbCreditor[]> {
  const { data, error } = await db
    .from("vb_creditors")
    .select("*")
    .order("sort_order")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as VbCreditor[];
}

export async function getCreditor(db: VbDb, id: string): Promise<VbCreditor | null> {
  const { data, error } = await db.from("vb_creditors").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as VbCreditor | null) ?? null;
}

export async function listEntries(
  db: VbDb,
  filter: { status: VbEntryStatus; creditorId?: string; batchId?: string },
): Promise<VbEntry[]> {
  const all: VbEntry[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = db
      .from("vb_entries")
      .select("*")
      .eq("status", filter.status)
      .order("entry_date")
      .order("sort_order")
      .order("created_at")
      .range(from, from + PAGE - 1);
    if (filter.creditorId) query = query.eq("creditor_id", filter.creditorId);
    if (filter.batchId) query = query.eq("import_batch_id", filter.batchId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as Record<string, unknown>[]).map(normalizeEntry);
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

export async function countPendingEntries(db: VbDb, creditorId: string): Promise<number> {
  const { count, error } = await db
    .from("vb_entries")
    .select("id", { count: "exact", head: true })
    .eq("creditor_id", creditorId)
    .eq("status", "pendente");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function getPendingBatch(db: VbDb): Promise<VbImportBatch | null> {
  const { data, error } = await db
    .from("vb_import_batches")
    .select("*")
    .eq("status", "pendente")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? normalizeBatch(data as Record<string, unknown>) : null;
}

export async function listBatches(db: VbDb): Promise<VbImportBatch[]> {
  const { data, error } = await db
    .from("vb_import_batches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(normalizeBatch);
}

export async function getBatch(db: VbDb, id: string): Promise<VbImportBatch | null> {
  const { data, error } = await db.from("vb_import_batches").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? normalizeBatch(data as Record<string, unknown>) : null;
}
```

- [ ] **Step 9: Visão geral — `src/app/(vb)/vb/page.tsx`**

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { currentYearBR, formatDayBR } from "@/lib/ctrl/datetime";
import { formatBRL } from "@/lib/orcamento/format";
import { createClient } from "@/lib/supabase/server";
import { getVbUser } from "@/lib/vb/auth";
import { currentBalance, sortLedger, yieldBySemester, yieldOf } from "@/lib/vb/ledger";
import { fromCents, sumCents } from "@/lib/vb/money";
import { getPendingBatch, listCreditors, listEntries } from "@/lib/vb/queries";
import type { VbEntry } from "@/lib/vb/types";

export const dynamic = "force-dynamic";

export default async function VbOverviewPage() {
  const user = await getVbUser();
  if (!user) redirect("/");
  const isGestor = user.role === "gestor";
  const db = await createClient();

  const [creditors, entries, pendingBatch] = await Promise.all([
    listCreditors(db),
    listEntries(db, { status: "aprovado" }),
    isGestor ? getPendingBatch(db) : Promise.resolve(null),
  ]);

  const year = currentYearBR();
  const years = [year - 1, year];
  const byCreditor = new Map<string, VbEntry[]>();
  for (const entry of entries) {
    const list = byCreditor.get(entry.creditor_id) ?? [];
    list.push(entry);
    byCreditor.set(entry.creditor_id, list);
  }

  const rows = creditors.map((creditor) => {
    const list = byCreditor.get(creditor.id) ?? [];
    const sorted = sortLedger(list);
    return {
      creditor,
      balance: currentBalance(list),
      lastDate: sorted.length > 0 ? sorted[sorted.length - 1].entry_date : null,
      yieldYear: yieldOf(list, year),
      semesters: yieldBySemester(list, years),
      count: list.length,
    };
  });
  const active = rows.filter((r) => r.creditor.active);
  const closed = rows.filter((r) => !r.creditor.active);
  const totalBalance = fromCents(sumCents(active.map((r) => r.balance)));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-primary">VB — Visão geral</h1>
          <p className="text-sm text-ink-muted">
            Créditos dos sócios e credores. Saldo positivo = o VB deve ao credor.
          </p>
        </div>
        {isGestor && (
          <Link
            href="/vb/importar"
            className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-ink-primary hover:bg-surface-2"
          >
            <Upload className="h-4 w-4" /> Importação
          </Link>
        )}
      </div>

      {pendingBatch && (
        <div className="flex items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <span className="text-ink-primary">
            Há uma importação pendente de revisão ({pendingBatch.file_name}). Os lançamentos dela
            não entram nos saldos até serem aprovados.
          </span>
          <Link href={`/vb/importar/${pendingBatch.id}`} className="ml-auto font-medium underline">
            Revisar
          </Link>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-ink-muted">Saldo total (ativos)</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-ink-primary">{formatBRL(totalBalance)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-ink-muted">Credores ativos</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-ink-primary">{active.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-ink-muted">Rendimentos em {year}</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-ink-primary">{formatBRL(yieldOf(entries, year))}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-ink-muted">Rendimentos em {year - 1}</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-ink-primary">{formatBRL(yieldOf(entries, year - 1))}</CardContent>
        </Card>
      </div>

      {creditors.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-ink-muted">
            Nenhum credor ainda.{" "}
            {isGestor ? (
              <Link href="/vb/importar" className="underline">
                Importe a planilha VB
              </Link>
            ) : (
              "Aguarde a importação do histórico."
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Credores</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Credor</TableHead>
                      <TableHead className="text-right">Saldo atual</TableHead>
                      <TableHead className="text-right">Rendimento em {year}</TableHead>
                      <TableHead className="text-right">Lançamentos</TableHead>
                      <TableHead>Último lançamento</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...active, ...closed].map((row) => (
                      <TableRow key={row.creditor.id}>
                        <TableCell>
                          <Link href={`/vb/credores/${row.creditor.id}`} className="font-medium underline-offset-2 hover:underline">
                            {row.creditor.name}
                          </Link>
                          {!row.creditor.active && (
                            <Badge variant="secondary" className="ml-2">
                              encerrado
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums ${row.balance < 0 ? "text-red-600" : ""}`}>
                          {formatBRL(row.balance)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatBRL(row.yieldYear)}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                        <TableCell>{formatDayBR(row.lastDate)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Custo de juros por semestre</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Credor</TableHead>
                      {years.flatMap((y) => [
                        <TableHead key={`${y}-1`} className="text-right">1º sem {y}</TableHead>,
                        <TableHead key={`${y}-2`} className="text-right">2º sem {y}</TableHead>,
                      ])}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {active.map((row) => (
                      <TableRow key={row.creditor.id}>
                        <TableCell className="font-medium">{row.creditor.name}</TableCell>
                        {row.semesters.map((s) => (
                          <TableCell key={`${s.year}-${s.semester}`} className="text-right tabular-nums">
                            {formatBRL(s.total)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell className="font-semibold">Total</TableCell>
                      {yieldBySemester(entries.filter((e) => active.some((r) => r.creditor.id === e.creditor_id)), years).map((s) => (
                        <TableCell key={`t-${s.year}-${s.semester}`} className="text-right font-semibold tabular-nums">
                          {formatBRL(s.total)}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 10: Lint, build, conferir no navegador e commit**

Run: `npm run lint && npm run build`

Subir `npm run dev` e abrir `http://localhost:3000/vb` com o usuário do Marcelo (usar o skill `aside-browser` no navegador logado dele; se não estiver disponível, pedir ao Marcelo que abra e reportar). Esperado: grupo **VB** no menu com "Visão geral" e "Importação"; a página mostra os cards zerados e "Nenhum credor ainda". Abrir com outro admin (ou remover temporariamente a linha de `user_module_roles` via SQL e recolocar): o grupo some e `/vb` redireciona para `/`.

```bash
git add src/lib/context src/components/app/navigation.ts src/components/app/nav-links.tsx src/components/app/app-shell.tsx "src/app/(app)/layout.tsx" "src/app/(ctrl)/ctrl/layout.tsx" "src/app/(case)/case/layout.tsx" "src/app/(viagens)/viagens/layout.tsx" "src/app/(vb)" src/lib/vb/queries.ts
git commit -m "feat(vb): módulo no menu, route group (vb) e visão geral

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Importação — rota de upload e server actions do lote

**Files:**
- Create: `src/lib/vb/import/to-rows.ts`
- Create: `src/lib/vb/import/to-rows.test.ts`
- Create: `src/app/api/vb/import/route.ts`
- Create: `src/lib/vb/actions/import.ts`
- Create: `src/lib/vb/actions/creditors.ts`

**Interfaces:**
- Consumes: `parseVbWorkbook`, `ParsedCreditor`, `ParsedEntry` (Task 4); `getVbUser`, `requireVbGestor` (Task 2); `createAdminClient` (`@/lib/supabase/admin`); `roundCents` (Task 4); `diffDaysIso` (Task 4); `VB_BLOCKING_FLAGS`, `VbImportSummary`, `VbActionResult` (Task 1).
- Produces: `toEntryRows(creditor, ctx): VbEntryInsert[]`; `POST /api/vb/import` (multipart `file`) → `{ batchId, summary }` ou `{ error }` (400/401/403/409/500); actions `approveImportBatch(batchId)`, `discardImportBatch(batchId)`, `updatePendingEntry(entryId, input: PendingEntryInput)`, `deletePendingEntry(entryId)`, `updateCreditor(creditorId, { name, active })`, tipo `PendingEntryInput { entry_date, kind, amount, description, period_start, period_end, rate }`.

- [ ] **Step 1: Teste do mapeamento parser → linhas (falha)**

Criar `src/lib/vb/import/to-rows.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import type { ParsedCreditor } from "@/lib/vb/import/parse-vb-workbook";
import { toEntryRows } from "@/lib/vb/import/to-rows";

const CREDITOR: ParsedCreditor = {
  sheetName: "Pedro P",
  name: "Pedro P",
  hidden: false,
  entries: [
    { sourceRow: 5, sortOrder: 51, entryDate: "2017-08-07", kind: "entrada", amount: 40000, description: "APORTE", periodStart: null, periodEnd: null, days: null, rate: null, rateBasis: null, sheetBalance: 40000, flags: [] },
    { sourceRow: 6, sortOrder: 60, entryDate: "2018-05-01", kind: "rendimento", amount: 3613.9, description: "RENDIMENTO", periodStart: "2017-08-08", periodEnd: "2018-05-01", days: 266, rate: 0.01, rateBasis: "mensal", sheetBalance: 43613.8951, flags: ["conferir"] },
  ],
  skippedRows: [],
  sheetFinalBalance: 43613.8951,
  computedFinalBalance: 43613.9,
  diff: 0,
  blockingCount: 0,
  warningCount: 1,
};

test("toEntryRows: uma linha de vb_entries por lançamento, pendente e ligada ao lote", () => {
  const rows = toEntryRows(CREDITOR, { creditorId: "c1", batchId: "b1", userId: "u1" });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    creditor_id: "c1",
    entry_date: "2017-08-07",
    kind: "entrada",
    amount: 40000,
    description: "APORTE",
    period_start: null,
    period_end: null,
    days: null,
    rate: null,
    rate_basis: null,
    status: "pendente",
    import_batch_id: "b1",
    source_row: 5,
    sheet_balance: 40000,
    sort_order: 51,
    flags: [],
    created_by: "u1",
  });
  assert.equal(rows[1].rate_basis, "mensal");
  assert.deepEqual(rows[1].flags, ["conferir"]);
  assert.equal(rows[1].period_start, "2017-08-08");
});
```

- [ ] **Step 2: Implementar `src/lib/vb/import/to-rows.ts`**

```ts
// Converte o resultado do parser nas linhas de vb_entries. Separado do route
// handler para ser testável sem banco.

import type { ParsedCreditor } from "@/lib/vb/import/parse-vb-workbook";
import type { VbEntry } from "@/lib/vb/types";

export type VbEntryInsert = Omit<VbEntry, "id" | "created_at" | "updated_at">;

export function toEntryRows(
  creditor: ParsedCreditor,
  ctx: { creditorId: string; batchId: string; userId: string },
): VbEntryInsert[] {
  return creditor.entries.map((e) => ({
    creditor_id: ctx.creditorId,
    entry_date: e.entryDate,
    kind: e.kind,
    amount: e.amount,
    description: e.description,
    period_start: e.periodStart,
    period_end: e.periodEnd,
    days: e.days,
    rate: e.rate,
    rate_basis: e.rateBasis,
    status: "pendente",
    import_batch_id: ctx.batchId,
    source_row: e.sourceRow,
    sheet_balance: e.sheetBalance,
    sort_order: e.sortOrder,
    flags: e.flags,
    created_by: ctx.userId,
  }));
}
```

- [ ] **Step 3: Rodar e ver passar**

Run: `npm test`
Expected: passa.

- [ ] **Step 4: Rota de upload — `src/app/api/vb/import/route.ts`**

```ts
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getVbUser } from "@/lib/vb/auth";
import { parseVbWorkbook, type ParsedWorkbook } from "@/lib/vb/import/parse-vb-workbook";
import { toEntryRows } from "@/lib/vb/import/to-rows";
import type { VbImportSummary } from "@/lib/vb/types";

const MAX_BYTES = 5 * 1024 * 1024;
const INSERT_CHUNK = 500;

/** Todas as abas da planilha já tinham credor aprovado — nada a importar. */
class AlreadyImportedError extends Error {
  constructor() {
    super("ja_importado");
  }
}

/**
 * POST multipart { file } → cria um lote PENDENTE com os lançamentos da
 * planilha. Nada vira oficial aqui: a aprovação é o server action
 * approveImportBatch, depois da revisão na tela.
 */
export async function POST(request: Request) {
  const user = await getVbUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (user.role !== "gestor") return NextResponse.json({ error: "Sem permissão." }, { status: 403 });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Envie um arquivo .xlsx." }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return NextResponse.json({ error: "O arquivo precisa ser .xlsx." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Arquivo acima de 5 MB." }, { status: 400 });
  }

  let parsed: ParsedWorkbook;
  try {
    parsed = parseVbWorkbook(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return NextResponse.json(
      { error: "Arquivo inválido: não foi possível ler a planilha." },
      { status: 400 },
    );
  }
  if (parsed.creditors.length === 0) {
    return NextResponse.json(
      {
        error:
          "Nenhuma aba de credor reconhecida (cabeçalho DATA | DATA | DIAS | DESCRIÇÃO | ENTRADA | SAÍDA | RENDIMENTO | SALDO na linha 4).",
      },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: pending } = await admin
    .from("vb_import_batches")
    .select("id")
    .eq("status", "pendente")
    .maybeSingle();
  if (pending) {
    return NextResponse.json(
      { error: "Já existe um lote pendente de revisão. Aprove ou descarte-o antes de importar outro." },
      { status: 409 },
    );
  }

  const { data: existingRows, error: existingError } = await admin
    .from("vb_creditors")
    .select("id, source_sheet");
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  const existingBySheet = new Map<string, { id: string }>();
  for (const row of existingRows ?? []) {
    if (row.source_sheet) existingBySheet.set(String(row.source_sheet).toLowerCase(), { id: row.id as string });
  }

  const { data: batch, error: batchError } = await admin
    .from("vb_import_batches")
    .insert({ file_name: file.name, status: "pendente", created_by: user.id, summary: {} })
    .select("id")
    .single();
  if (batchError || !batch) {
    // 23505 = índice único do "um pendente por vez" (corrida entre dois uploads).
    const conflict = batchError?.code === "23505";
    return NextResponse.json(
      { error: conflict ? "Já existe um lote pendente de revisão." : batchError?.message ?? "Falha ao criar o lote." },
      { status: conflict ? 409 : 500 },
    );
  }
  const batchId = batch.id as string;

  const summary: VbImportSummary = {
    creditors: [],
    skippedSheets: [],
    emptySheets: parsed.emptySheets,
    ignoredSheets: parsed.ignoredSheets,
  };
  const createdCreditorIds: string[] = [];

  try {
    for (let index = 0; index < parsed.creditors.length; index++) {
      const creditor = parsed.creditors[index];
      const existing = existingBySheet.get(creditor.sheetName.toLowerCase());
      let creditorId: string;
      if (existing) {
        // Credor já aprovado não é reimportado — duplicaria o histórico.
        const { count, error } = await admin
          .from("vb_entries")
          .select("id", { count: "exact", head: true })
          .eq("creditor_id", existing.id)
          .eq("status", "aprovado");
        if (error) throw new Error(error.message);
        if ((count ?? 0) > 0) {
          summary.skippedSheets.push({ sheetName: creditor.sheetName, reason: "ja_importado" });
          continue;
        }
        creditorId = existing.id;
      } else {
        const { data: created, error } = await admin
          .from("vb_creditors")
          .insert({
            name: creditor.name,
            active: !creditor.hidden,
            source_sheet: creditor.sheetName,
            sort_order: index,
          })
          .select("id")
          .single();
        if (error || !created) throw new Error(error?.message ?? "Falha ao criar credor.");
        creditorId = created.id as string;
        createdCreditorIds.push(creditorId);
      }

      const rows = toEntryRows(creditor, { creditorId, batchId, userId: user.id });
      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        const { error } = await admin.from("vb_entries").insert(rows.slice(i, i + INSERT_CHUNK));
        if (error) throw new Error(error.message);
      }

      summary.creditors.push({
        creditorId,
        sheetName: creditor.sheetName,
        name: creditor.name,
        hidden: creditor.hidden,
        entries: creditor.entries.length,
        skippedRows: creditor.skippedRows.length,
        sheetFinalBalance: creditor.sheetFinalBalance,
        computedFinalBalance: creditor.computedFinalBalance,
        diff: creditor.diff,
        blockingCount: creditor.blockingCount,
        warningCount: creditor.warningCount,
      });
    }

    if (summary.creditors.length === 0) {
      throw new AlreadyImportedError();
    }

    const { error: summaryError } = await admin
      .from("vb_import_batches")
      .update({ summary })
      .eq("id", batchId);
    if (summaryError) throw new Error(summaryError.message);
  } catch (err) {
    // Desfaz o que este lote criou (o lote só existe de verdade depois daqui).
    await admin.from("vb_entries").delete().eq("import_batch_id", batchId);
    if (createdCreditorIds.length > 0) {
      await admin.from("vb_creditors").delete().in("id", createdCreditorIds);
    }
    await admin.from("vb_import_batches").delete().eq("id", batchId);
    if (err instanceof AlreadyImportedError) {
      return NextResponse.json(
        { error: "Todos os credores da planilha já foram importados e aprovados." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Falha ao importar." },
      { status: 500 },
    );
  }

  return NextResponse.json({ batchId, summary });
}
```

- [ ] **Step 5: Actions do lote — `src/lib/vb/actions/import.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireVbGestor } from "@/lib/vb/auth";
import { diffDaysIso } from "@/lib/vb/import/excel-date";
import { roundCents } from "@/lib/vb/money";
import {
  VB_BLOCKING_FLAGS,
  type VbActionResult,
  type VbEntryFlag,
  type VbImportSummary,
} from "@/lib/vb/types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const pendingEntrySchema = z.object({
  entry_date: z.string().regex(ISO_DATE, "Data inválida."),
  kind: z.enum(["entrada", "saida", "rendimento"]),
  amount: z.number(),
  description: z.string().trim().max(300, "Descrição longa demais.").nullable(),
  period_start: z.string().regex(ISO_DATE, "Início do período inválido.").nullable(),
  period_end: z.string().regex(ISO_DATE, "Fim do período inválido.").nullable(),
  /** Fração (0.0335 = 3,35%). */
  rate: z.number().nullable(),
});

export type PendingEntryInput = z.infer<typeof pendingEntrySchema>;

function revalidateVb(batchId?: string | null) {
  revalidatePath("/vb");
  revalidatePath("/vb/importar");
  revalidatePath("/vb/credores/[id]", "page");
  if (batchId) revalidatePath(`/vb/importar/${batchId}`);
}

/** Aprova o lote inteiro numa transação (função SQL vb_approve_import_batch). */
export async function approveImportBatch(
  batchId: string,
): Promise<VbActionResult<{ approved: number }>> {
  const user = await requireVbGestor();
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("vb_approve_import_batch", {
    p_batch_id: batchId,
    p_user_id: user.id,
  });
  if (error) return { error: error.message };
  revalidateVb(batchId);
  return { ok: true, approved: Number(data ?? 0) };
}

/**
 * Apaga os lançamentos pendentes do lote e os credores que ficaram sem nenhum
 * lançamento. A linha do lote fica, como 'descartado'.
 */
export async function discardImportBatch(batchId: string): Promise<VbActionResult> {
  await requireVbGestor();
  const admin = createAdminClient();

  const { data: batch, error: batchError } = await admin
    .from("vb_import_batches")
    .select("id, status, summary")
    .eq("id", batchId)
    .maybeSingle();
  if (batchError) return { error: batchError.message };
  if (!batch) return { error: "Lote não encontrado." };
  if (batch.status !== "pendente") return { error: "Só lotes pendentes podem ser descartados." };

  const { error: deleteError } = await admin
    .from("vb_entries")
    .delete()
    .eq("import_batch_id", batchId)
    .eq("status", "pendente");
  if (deleteError) return { error: deleteError.message };

  const summary = (batch.summary ?? {}) as Partial<VbImportSummary>;
  for (const creditor of summary.creditors ?? []) {
    const { count } = await admin
      .from("vb_entries")
      .select("id", { count: "exact", head: true })
      .eq("creditor_id", creditor.creditorId);
    if ((count ?? 0) === 0) {
      await admin.from("vb_creditors").delete().eq("id", creditor.creditorId);
    }
  }

  const { error: updateError } = await admin
    .from("vb_import_batches")
    .update({ status: "descartado", discarded_at: new Date().toISOString() })
    .eq("id", batchId);
  if (updateError) return { error: updateError.message };

  revalidateVb(batchId);
  return { ok: true };
}

/**
 * Edita um lançamento PENDENTE. Remove as flags bloqueantes (o gestor acabou
 * de olhar a linha); as demais ficam como registro do que a planilha trazia.
 */
export async function updatePendingEntry(
  entryId: string,
  input: PendingEntryInput,
): Promise<VbActionResult> {
  await requireVbGestor();
  const parsed = pendingEntrySchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const v = parsed.data;

  const amount = roundCents(v.amount);
  if (amount === 0) return { error: "Valor não pode ser zero." };
  if (v.kind === "entrada" && amount < 0) return { error: "Entrada precisa ser positiva." };
  if (v.kind === "saida" && amount > 0) return { error: "Saída precisa ser negativa." };

  let period_start: string | null = null;
  let period_end: string | null = null;
  let days: number | null = null;
  let rate: number | null = null;
  if (v.kind === "rendimento") {
    period_end = v.period_end ?? v.entry_date;
    period_start = v.period_start ?? period_end;
    if (period_start > period_end) return { error: "Início do período depois do fim." };
    days = diffDaysIso(period_start, period_end);
    rate = v.rate;
  }

  const admin = createAdminClient();
  const { data: current, error: readError } = await admin
    .from("vb_entries")
    .select("id, status, flags, import_batch_id, rate_basis")
    .eq("id", entryId)
    .maybeSingle();
  if (readError) return { error: readError.message };
  if (!current) return { error: "Lançamento não encontrado." };
  if (current.status !== "pendente") return { error: "Só lançamentos pendentes podem ser editados." };

  const flags = ((current.flags as string[] | null) ?? []).filter(
    (flag) => !VB_BLOCKING_FLAGS.has(flag as VbEntryFlag),
  );

  const { error } = await admin
    .from("vb_entries")
    .update({
      entry_date: v.entry_date,
      kind: v.kind,
      amount,
      description: v.description || null,
      period_start,
      period_end,
      days,
      rate,
      rate_basis: v.kind === "rendimento" ? (current.rate_basis ?? "ajuste") : null,
      flags,
    })
    .eq("id", entryId)
    .eq("status", "pendente");
  if (error) return { error: error.message };

  revalidateVb(current.import_batch_id as string | null);
  return { ok: true };
}

export async function deletePendingEntry(entryId: string): Promise<VbActionResult> {
  await requireVbGestor();
  const admin = createAdminClient();
  const { data: current, error: readError } = await admin
    .from("vb_entries")
    .select("id, status, import_batch_id")
    .eq("id", entryId)
    .maybeSingle();
  if (readError) return { error: readError.message };
  if (!current) return { error: "Lançamento não encontrado." };
  if (current.status !== "pendente") return { error: "Só lançamentos pendentes podem ser excluídos." };

  const { error } = await admin.from("vb_entries").delete().eq("id", entryId).eq("status", "pendente");
  if (error) return { error: error.message };

  revalidateVb(current.import_batch_id as string | null);
  return { ok: true };
}
```

- [ ] **Step 6: Action do credor — `src/lib/vb/actions/creditors.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireVbGestor } from "@/lib/vb/auth";
import type { VbActionResult } from "@/lib/vb/types";

const creditorSchema = z.object({
  name: z.string().trim().min(1, "Nome obrigatório.").max(120, "Nome longo demais."),
  active: z.boolean(),
});

export async function updateCreditor(
  creditorId: string,
  input: { name: string; active: boolean },
): Promise<VbActionResult> {
  await requireVbGestor();
  const parsed = creditorSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("vb_creditors")
    .update({ name: parsed.data.name, active: parsed.data.active })
    .eq("id", creditorId);
  if (error) return { error: error.message };

  revalidatePath("/vb");
  revalidatePath("/vb/importar/[batchId]", "page");
  revalidatePath(`/vb/credores/${creditorId}`);
  return { ok: true };
}
```

- [ ] **Step 7: Lint, build e teste manual da rota**

Run: `npm run lint && npm run build`

Com o `npm run dev` de pé e o navegador logado como Marcelo, não há como chamar a rota sem a tela (cookie de sessão). O teste de ponta a ponta fica para a Task 8; aqui basta build limpo.

```bash
git add src/lib/vb/import/to-rows.ts src/lib/vb/import/to-rows.test.ts src/app/api/vb src/lib/vb/actions/import.ts src/lib/vb/actions/creditors.ts
git commit -m "feat(vb): upload da planilha em lote pendente e actions de revisão

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Telas de importação (upload, lista de lotes, revisão)

**Files:**
- Create: `src/components/vb/import-upload.tsx`
- Create: `src/components/vb/entry-edit-dialog.tsx`
- Create: `src/components/vb/batch-review.tsx`
- Create: `src/app/(vb)/vb/importar/page.tsx`
- Create: `src/app/(vb)/vb/importar/[batchId]/page.tsx`

**Interfaces:**
- Consumes: `getVbUser` (Task 2); `listBatches`, `getBatch`, `listCreditors`, `listEntries` (Task 6); `withSheetOrderBalance`, `ledgerTotals`, `currentBalance`, `WithBalance`, `LedgerTotals` (Task 5); `describeRendimento` (Task 5); `approveImportBatch`, `discardImportBatch`, `updatePendingEntry`, `deletePendingEntry`, `PendingEntryInput` (Task 7); `updateCreditor` (Task 7); `VB_FLAG_LABELS`, `VB_KIND_LABELS`, `VB_BALANCE_TOLERANCE`, `isBlockingFlag` (Task 1); `formatBRL`, `parseBrNumber`, `numberToInput` (`@/lib/orcamento/format`); `formatDayBR`, `formatDateTimeBR` (`@/lib/ctrl/datetime`); `useToast` (`@/components/ui/toaster`).
- Produces: `VbImportUpload`, `VbEntryEditDialog`, `VbBatchReview` e o tipo `ReviewGroup`.

- [ ] **Step 1: Upload — `src/components/vb/import-upload.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";

interface Props {
  /** Id do lote pendente, se houver — bloqueia novo upload. */
  pendingBatchId: string | null;
}

export function VbImportUpload({ pendingBatchId }: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!file) return;
    setBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/vb/import", { method: "POST", body: formData });
      const json = (await res.json().catch(() => ({}))) as { batchId?: string; error?: string };
      if (!res.ok || !json.batchId) {
        showToast({ title: "Importação não iniciada", description: json.error ?? "Falha ao enviar o arquivo.", variant: "destructive" });
        return;
      }
      showToast({ title: "Planilha lida", description: "Revise os lançamentos antes de aprovar.", variant: "success" });
      router.push(`/vb/importar/${json.batchId}`);
    } finally {
      setBusy(false);
    }
  }

  if (pendingBatchId) {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-ink-primary">
        Há um lote pendente de revisão. Aprove ou descarte-o antes de importar outra planilha.{" "}
        <Link href={`/vb/importar/${pendingBatchId}`} className="font-medium underline">
          Abrir revisão
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-1 p-4">
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        className="text-sm"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        disabled={busy}
      />
      <Button type="button" onClick={submit} disabled={!file || busy}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
        Importar planilha
      </Button>
      <p className="basis-full text-xs text-ink-muted">
        Só abas com o cabeçalho DATA | DATA | DIAS | DESCRIÇÃO | ENTRADA | SAÍDA | RENDIMENTO | SALDO na linha 4
        são lidas. Credores já aprovados são pulados. Nada vira oficial antes de você aprovar o lote.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Lista de lotes — `src/app/(vb)/vb/importar/page.tsx`**

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";

import { VbImportUpload } from "@/components/vb/import-upload";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTimeBR } from "@/lib/ctrl/datetime";
import { createClient } from "@/lib/supabase/server";
import { getVbUser } from "@/lib/vb/auth";
import { listBatches } from "@/lib/vb/queries";
import type { VbBatchStatus } from "@/lib/vb/types";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<VbBatchStatus, string> = {
  pendente: "Pendente de revisão",
  aprovado: "Aprovado",
  descartado: "Descartado",
};

const STATUS_VARIANT: Record<VbBatchStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pendente: "default",
  aprovado: "secondary",
  descartado: "outline",
};

export default async function VbImportPage() {
  const user = await getVbUser();
  if (!user) redirect("/");
  if (user.role !== "gestor") redirect("/vb");

  const db = await createClient();
  const batches = await listBatches(db);
  const pending = batches.find((b) => b.status === "pendente") ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-primary">VB — Importação</h1>
        <p className="text-sm text-ink-muted">
          Traga o histórico da planilha VB. Cada upload vira um lote que você revisa e aprova.
        </p>
      </div>

      <VbImportUpload pendingBatchId={pending?.id ?? null} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lotes</CardTitle>
        </CardHeader>
        <CardContent>
          {batches.length === 0 ? (
            <p className="text-sm text-ink-muted">Nenhuma importação ainda.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Arquivo</TableHead>
                  <TableHead>Enviado em</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Credores</TableHead>
                  <TableHead className="text-right">Lançamentos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <Link href={`/vb/importar/${b.id}`} className="font-medium underline-offset-2 hover:underline">
                        {b.file_name}
                      </Link>
                    </TableCell>
                    <TableCell>{formatDateTimeBR(b.created_at)}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[b.status]}>{STATUS_LABEL[b.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{b.summary.creditors.length}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {b.summary.creditors.reduce((acc, c) => acc + c.entries, 0)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Diálogo de edição — `src/components/vb/entry-edit-dialog.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

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
import { numberToInput, parseBrNumber } from "@/lib/orcamento/format";
import { updatePendingEntry } from "@/lib/vb/actions/import";
import { VB_KIND_LABELS, type VbEntry, type VbEntryKind } from "@/lib/vb/types";

interface Props {
  entry: VbEntry | null;
  onClose: () => void;
}

const SELECT_CLS =
  "h-9 w-full rounded-md border border-border bg-surface-1 px-3 text-sm text-ink-primary outline-none focus:ring-2 focus:ring-teal-500/40";

/** Edita um lançamento PENDENTE da revisão. Valor sempre positivo no formulário; o sinal vem do tipo. */
export function VbEntryEditDialog({ entry, onClose }: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState("");
  const [kind, setKind] = useState<VbEntryKind>("entrada");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [ratePct, setRatePct] = useState("");

  useEffect(() => {
    if (!entry) return;
    setDate(entry.entry_date);
    setKind(entry.kind);
    setAmount(numberToInput(entry.kind === "rendimento" ? entry.amount : Math.abs(entry.amount)));
    setDescription(entry.description ?? "");
    setPeriodStart(entry.period_start ?? "");
    setPeriodEnd(entry.period_end ?? entry.entry_date);
    setRatePct(entry.rate == null ? "" : numberToInput(entry.rate * 100));
  }, [entry]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!entry) return;
    const raw = parseBrNumber(amount);
    if (raw == null || Number.isNaN(raw)) {
      showToast({ title: "Valor inválido", variant: "destructive" });
      return;
    }
    const signed = kind === "entrada" ? Math.abs(raw) : kind === "saida" ? -Math.abs(raw) : raw;
    const rate = ratePct.trim() ? parseBrNumber(ratePct) : null;
    if (rate != null && Number.isNaN(rate)) {
      showToast({ title: "Taxa inválida", variant: "destructive" });
      return;
    }
    startTransition(async () => {
      const result = await updatePendingEntry(entry.id, {
        entry_date: date,
        kind,
        amount: signed,
        description: description.trim() || null,
        period_start: kind === "rendimento" && periodStart ? periodStart : null,
        period_end: kind === "rendimento" && periodEnd ? periodEnd : null,
        rate: kind === "rendimento" && rate != null ? rate / 100 : null,
      });
      if ("error" in result) {
        showToast({ title: "Não salvo", description: result.error, variant: "destructive" });
        return;
      }
      showToast({ title: "Lançamento atualizado", variant: "success" });
      router.refresh();
      onClose();
    });
  }

  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Editar lançamento</DialogTitle>
            <DialogDescription>
              Linha {entry?.source_row ?? "—"} da planilha. Corrigir aqui remove os alertas bloqueantes desta linha.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="vb-edit-date">Data</Label>
              <Input id="vb-edit-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="vb-edit-kind">Tipo</Label>
              <select id="vb-edit-kind" className={SELECT_CLS} value={kind} onChange={(e) => setKind(e.target.value as VbEntryKind)}>
                {(Object.keys(VB_KIND_LABELS) as VbEntryKind[]).map((k) => (
                  <option key={k} value={k}>{VB_KIND_LABELS[k]}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="vb-edit-amount">Valor (R$)</Label>
              <Input id="vb-edit-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="vb-edit-desc">Descrição</Label>
              <Input id="vb-edit-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
            </div>
            {kind === "rendimento" && (
              <>
                <div>
                  <Label htmlFor="vb-edit-ps">Início do período</Label>
                  <Input id="vb-edit-ps" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="vb-edit-pe">Fim do período</Label>
                  <Input id="vb-edit-pe" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="vb-edit-rate">Taxa (%)</Label>
                  <Input id="vb-edit-rate" inputMode="decimal" value={ratePct} onChange={(e) => setRatePct(e.target.value)} placeholder="3,35" />
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Revisão do lote — `src/components/vb/batch-review.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Check, Loader2, Pencil, Trash2, X } from "lucide-react";

import { VbEntryEditDialog } from "@/components/vb/entry-edit-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toaster";
import { formatDateTimeBR, formatDayBR } from "@/lib/ctrl/datetime";
import { formatBRL } from "@/lib/orcamento/format";
import { updateCreditor } from "@/lib/vb/actions/creditors";
import {
  approveImportBatch,
  deletePendingEntry,
  discardImportBatch,
} from "@/lib/vb/actions/import";
import { describeRendimento } from "@/lib/vb/format";
import type { LedgerTotals, WithBalance } from "@/lib/vb/ledger";
import {
  VB_BALANCE_TOLERANCE,
  VB_FLAG_LABELS,
  isBlockingFlag,
  type VbCreditor,
  type VbEntry,
  type VbEntryFlag,
  type VbImportBatch,
} from "@/lib/vb/types";

export interface ReviewGroup {
  creditor: VbCreditor;
  /** Em ordem de PLANILHA, com o saldo acumulado nessa ordem. */
  rows: WithBalance<VbEntry>[];
  totals: LedgerTotals;
  sheetFinalBalance: number | null;
  computedFinalBalance: number;
  diff: number | null;
  blockingCount: number;
  warningCount: number;
}

interface Props {
  batch: VbImportBatch;
  groups: ReviewGroup[];
}

function DiffBadge({ diff }: { diff: number | null }) {
  if (diff === null) return <Badge variant="outline">sem saldo na planilha</Badge>;
  const ok = Math.abs(diff) <= VB_BALANCE_TOLERANCE;
  return (
    <Badge variant={ok ? "secondary" : "destructive"}>
      {ok ? "fecha" : "divergência"} ({diff >= 0 ? "+" : ""}{formatBRL(diff)})
    </Badge>
  );
}

function FlagBadges({ flags }: { flags: VbEntryFlag[] }) {
  if (flags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <Badge key={f} variant={isBlockingFlag(f) ? "destructive" : "outline"} className="whitespace-nowrap">
          {VB_FLAG_LABELS[f]}
        </Badge>
      ))}
    </div>
  );
}

function CreditorHeader({ group }: { group: ReviewGroup }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(group.creditor.name);
  const [active, setActive] = useState(group.creditor.active);
  const dirty = name.trim() !== group.creditor.name || active !== group.creditor.active;

  function save() {
    startTransition(async () => {
      const result = await updateCreditor(group.creditor.id, { name, active });
      if ("error" in result) {
        showToast({ title: "Não salvo", description: result.error, variant: "destructive" });
        return;
      }
      showToast({ title: "Credor atualizado", variant: "success" });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-[220px]">
        <label className="mb-1 block text-xs font-medium text-ink-secondary" htmlFor={`name-${group.creditor.id}`}>
          Nome do credor (aba &ldquo;{group.creditor.source_sheet ?? "—"}&rdquo;)
        </label>
        <Input id={`name-${group.creditor.id}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
      </div>
      <button
        type="button"
        onClick={() => setActive((v) => !v)}
        className={`inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm ${active ? "border-teal-600 text-teal-700" : "border-border text-ink-muted"}`}
      >
        {active ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
        {active ? "Ativo" : "Encerrado"}
      </button>
      <Button type="button" size="sm" onClick={save} disabled={!dirty || pending}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Salvar credor
      </Button>
    </div>
  );
}

export function VbBatchReview({ batch, groups }: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [activeId, setActiveId] = useState<string | null>(groups[0]?.creditor.id ?? null);
  const [editing, setEditing] = useState<VbEntry | null>(null);
  const [confirm, setConfirm] = useState<"approve" | "discard" | null>(null);
  const [deleting, setDeleting] = useState<VbEntry | null>(null);

  const isPending = batch.status === "pendente";
  const totalBlocking = useMemo(() => groups.reduce((acc, g) => acc + g.blockingCount, 0), [groups]);
  const totalEntries = useMemo(() => groups.reduce((acc, g) => acc + g.rows.length, 0), [groups]);
  const active = groups.find((g) => g.creditor.id === activeId) ?? groups[0] ?? null;

  function runApprove() {
    startTransition(async () => {
      const result = await approveImportBatch(batch.id);
      if ("error" in result) {
        showToast({ title: "Lote não aprovado", description: result.error, variant: "destructive" });
        return;
      }
      showToast({ title: "Histórico aprovado", description: `${result.approved} lançamentos agora são oficiais.`, variant: "success" });
      setConfirm(null);
      router.push("/vb");
      router.refresh();
    });
  }

  function runDiscard() {
    startTransition(async () => {
      const result = await discardImportBatch(batch.id);
      if ("error" in result) {
        showToast({ title: "Lote não descartado", description: result.error, variant: "destructive" });
        return;
      }
      showToast({ title: "Lote descartado", variant: "default" });
      setConfirm(null);
      router.push("/vb/importar");
      router.refresh();
    });
  }

  function runDelete(entry: VbEntry) {
    startTransition(async () => {
      const result = await deletePendingEntry(entry.id);
      if ("error" in result) {
        showToast({ title: "Não excluído", description: result.error, variant: "destructive" });
        return;
      }
      setDeleting(null);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-primary">Revisão da importação</h1>
          <p className="text-sm text-ink-muted">
            {batch.file_name} · enviado em {formatDateTimeBR(batch.created_at)} ·{" "}
            <Badge variant={isPending ? "default" : batch.status === "aprovado" ? "secondary" : "outline"}>
              {isPending ? "pendente" : batch.status}
            </Badge>
          </p>
        </div>
        {isPending && (
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirm("discard")} disabled={pending}>
              Descartar
            </Button>
            <Button type="button" onClick={() => setConfirm("approve")} disabled={pending || totalBlocking > 0}>
              Aprovar importação
              {totalBlocking > 0 && ` (${totalBlocking} bloqueio${totalBlocking > 1 ? "s" : ""})`}
            </Button>
          </div>
        )}
      </div>

      {!isPending && (
        <Card>
          <CardContent className="py-4 text-sm text-ink-muted">
            {batch.status === "aprovado"
              ? `Lote aprovado em ${formatDateTimeBR(batch.approved_at)}. Os lançamentos estão no extrato de cada credor.`
              : `Lote descartado em ${formatDateTimeBR(batch.discarded_at)}.`}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Resumo</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Credor</TableHead>
                <TableHead>Aba</TableHead>
                <TableHead className="text-right">Lançamentos</TableHead>
                <TableHead className="text-right">Saldo planilha</TableHead>
                <TableHead className="text-right">Saldo sistema</TableHead>
                <TableHead>Conferência</TableHead>
                <TableHead className="text-right">Bloqueios</TableHead>
                <TableHead className="text-right">Avisos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batch.summary.creditors.map((c) => {
                const live = groups.find((g) => g.creditor.id === c.creditorId);
                const sheet = c.sheetFinalBalance;
                const computed = live ? live.computedFinalBalance : c.computedFinalBalance;
                const diff = live ? live.diff : c.diff;
                return (
                  <TableRow key={c.creditorId} className={live && activeId === c.creditorId ? "bg-surface-2" : undefined}>
                    <TableCell>
                      {live ? (
                        <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => setActiveId(c.creditorId)}>
                          {live.creditor.name}
                        </button>
                      ) : (
                        c.name
                      )}
                      {c.hidden && <Badge variant="outline" className="ml-2">aba oculta</Badge>}
                    </TableCell>
                    <TableCell className="text-ink-muted">{c.sheetName}</TableCell>
                    <TableCell className="text-right tabular-nums">{live ? live.rows.length : c.entries}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatBRL(sheet)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatBRL(computed)}</TableCell>
                    <TableCell><DiffBadge diff={diff} /></TableCell>
                    <TableCell className="text-right tabular-nums">{live ? live.blockingCount : c.blockingCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{live ? live.warningCount : c.warningCount}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {(batch.summary.skippedSheets.length > 0 || batch.summary.emptySheets.length > 0 || batch.summary.ignoredSheets.length > 0) && (
            <p className="mt-3 text-xs text-ink-muted">
              {batch.summary.skippedSheets.length > 0 && (
                <>Já importados (pulados): {batch.summary.skippedSheets.map((s) => s.sheetName).join(", ")}. </>
              )}
              {batch.summary.emptySheets.length > 0 && <>Abas vazias: {batch.summary.emptySheets.join(", ")}. </>}
              {batch.summary.ignoredSheets.length > 0 && <>Abas fora do VB: {batch.summary.ignoredSheets.join(", ")}.</>}
            </p>
          )}
          {isPending && totalEntries > 0 && (
            <p className="mt-2 text-xs text-ink-muted">
              Diferença até {formatBRL(VB_BALANCE_TOLERANCE)} por credor é arredondamento para centavos. Divergência maior não impede aprovar, mas vale corrigir a linha antes.
            </p>
          )}
        </CardContent>
      </Card>

      {isPending && active && (
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {groups.map((g) => (
                <button
                  key={g.creditor.id}
                  type="button"
                  onClick={() => setActiveId(g.creditor.id)}
                  className={`rounded-full border px-3 py-1 text-sm ${g.creditor.id === active.creditor.id ? "border-teal-600 bg-teal-600/10 font-medium text-teal-700" : "border-border text-ink-secondary hover:bg-surface-2"}`}
                >
                  {g.creditor.name}
                  {g.blockingCount > 0 && <span className="ml-1 text-red-600">•{g.blockingCount}</span>}
                </button>
              ))}
            </div>
            <CreditorHeader key={active.creditor.id} group={active} />
            <div className="flex flex-wrap gap-4 text-sm text-ink-secondary">
              <span>Entradas: <strong className="text-ink-primary">{formatBRL(active.totals.entradas)}</strong></span>
              <span>Saídas: <strong className="text-ink-primary">{formatBRL(active.totals.saidas)}</strong></span>
              <span>Rendimentos: <strong className="text-ink-primary">{formatBRL(active.totals.rendimentos)}</strong></span>
              <span>Saldo sistema: <strong className="text-ink-primary">{formatBRL(active.computedFinalBalance)}</strong></span>
              <span>Saldo planilha: <strong className="text-ink-primary">{formatBRL(active.sheetFinalBalance)}</strong></span>
              <DiffBadge diff={active.diff} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">Linha</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="text-right">Entrada</TableHead>
                    <TableHead className="text-right">Saída</TableHead>
                    <TableHead className="text-right">Rendimento</TableHead>
                    <TableHead className="text-right">Saldo planilha</TableHead>
                    <TableHead className="text-right">Saldo sistema</TableHead>
                    <TableHead>Alertas</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {active.rows.map((row) => {
                    const sheetDiff = row.sheet_balance == null ? null : row.balance - row.sheet_balance;
                    const sheetOff = sheetDiff !== null && Math.abs(sheetDiff) > VB_BALANCE_TOLERANCE;
                    return (
                      <TableRow key={row.id} className={row.flags.some(isBlockingFlag) ? "bg-red-500/5" : undefined}>
                        <TableCell className="text-right tabular-nums text-ink-muted">{row.source_row ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDayBR(row.entry_date)}</TableCell>
                        <TableCell>
                          <div>{row.description ?? "—"}</div>
                          {row.kind === "rendimento" && (
                            <div className="text-xs text-ink-muted">{describeRendimento(row)}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{row.kind === "entrada" ? formatBRL(row.amount) : ""}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.kind === "saida" ? formatBRL(Math.abs(row.amount)) : ""}</TableCell>
                        <TableCell className={`text-right tabular-nums ${row.kind === "rendimento" && row.amount < 0 ? "text-red-600" : ""}`}>
                          {row.kind === "rendimento" ? formatBRL(row.amount) : ""}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-ink-muted">{formatBRL(row.sheet_balance)}</TableCell>
                        <TableCell className={`text-right tabular-nums ${sheetOff ? "font-semibold text-red-600" : ""}`}>{formatBRL(row.balance)}</TableCell>
                        <TableCell><FlagBadges flags={row.flags} /></TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Button type="button" variant="ghost" size="icon" onClick={() => setEditing(row)} aria-label="Editar">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button type="button" variant="ghost" size="icon" onClick={() => setDeleting(row)} aria-label="Excluir">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {!isPending && (
        <p className="text-sm">
          <Link href="/vb/importar" className="underline">Voltar para a importação</Link>
        </p>
      )}

      <VbEntryEditDialog entry={editing} onClose={() => setEditing(null)} />

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir lançamento?</DialogTitle>
            <DialogDescription>
              Linha {deleting?.source_row ?? "—"}: {deleting?.description ?? "—"} ({formatBRL(deleting?.amount ?? null)}). A linha some deste lote; a planilha não muda.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleting(null)} disabled={pending}>Cancelar</Button>
            <Button type="button" variant="destructive" onClick={() => deleting && runDelete(deleting)} disabled={pending}>Excluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm === "approve" ? "Aprovar a importação?" : "Descartar o lote?"}</DialogTitle>
            <DialogDescription>
              {confirm === "approve"
                ? `${totalEntries} lançamentos de ${groups.length} credor(es) passam a ser o histórico oficial do VB. Depois de aprovado, o histórico não é editado.`
                : "Todos os lançamentos pendentes deste lote são apagados. Você pode importar a planilha de novo depois."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirm(null)} disabled={pending}>Cancelar</Button>
            <Button
              type="button"
              variant={confirm === "approve" ? "default" : "destructive"}
              onClick={confirm === "approve" ? runApprove : runDiscard}
              disabled={pending}
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {confirm === "approve" ? "Aprovar" : "Descartar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 5: Página da revisão — `src/app/(vb)/vb/importar/[batchId]/page.tsx`**

```tsx
import { notFound, redirect } from "next/navigation";

import { VbBatchReview, type ReviewGroup } from "@/components/vb/batch-review";
import { createClient } from "@/lib/supabase/server";
import { getVbUser } from "@/lib/vb/auth";
import { currentBalance, ledgerTotals, withSheetOrderBalance } from "@/lib/vb/ledger";
import { roundCents } from "@/lib/vb/money";
import { getBatch, listCreditors, listEntries } from "@/lib/vb/queries";
import { isBlockingFlag } from "@/lib/vb/types";

export const dynamic = "force-dynamic";

export default async function VbBatchPage({ params }: { params: { batchId: string } }) {
  const user = await getVbUser();
  if (!user) redirect("/");
  if (user.role !== "gestor") redirect("/vb");

  const db = await createClient();
  const batch = await getBatch(db, params.batchId);
  if (!batch) notFound();

  const creditorIds = new Set(batch.summary.creditors.map((c) => c.creditorId));
  const [creditors, entries] = await Promise.all([
    listCreditors(db),
    batch.status === "pendente" ? listEntries(db, { status: "pendente", batchId: batch.id }) : Promise.resolve([]),
  ]);

  const groups: ReviewGroup[] = creditors
    .filter((c) => creditorIds.has(c.id))
    .map((creditor) => {
      const list = entries.filter((e) => e.creditor_id === creditor.id);
      const rows = withSheetOrderBalance(list);
      const sheetFinalBalance =
        batch.summary.creditors.find((c) => c.creditorId === creditor.id)?.sheetFinalBalance ?? null;
      const computedFinalBalance = currentBalance(list);
      return {
        creditor,
        rows,
        totals: ledgerTotals(list),
        sheetFinalBalance,
        computedFinalBalance,
        diff: sheetFinalBalance === null ? null : roundCents(computedFinalBalance - sheetFinalBalance),
        blockingCount: rows.filter((r) => r.flags.some(isBlockingFlag)).length,
        warningCount: rows.filter((r) => r.flags.length > 0 && !r.flags.some(isBlockingFlag)).length,
      };
    });

  return <VbBatchReview batch={batch} groups={groups} />;
}
```

- [ ] **Step 6: Lint, build e fluxo completo no navegador**

Run: `npm run lint && npm run build`

Com `npm run dev` e o navegador logado como Marcelo:

1. `/vb/importar` → enviar `docs/VB TERRAZZO V2.xlsx` → redireciona para a revisão. Resumo: 9 credores, Fabio/Mirai/Renan com "aba oculta", todos com badge "fecha", 0 bloqueios. Rodapé: "Abas vazias: Mylliano" e as abas fora do VB.
2. Clicar em "Mylliano ( Sr Jorge)" → renomear para "Mylliano", salvar → nome atualiza na lista.
3. Editar um lançamento (ex.: trocar a descrição) → tabela atualiza; excluir um lançamento de teste NÃO (para não alterar o histórico) — se testar exclusão, descartar o lote e reimportar antes de aprovar.
4. "Aprovar importação" → confirmar → volta para `/vb` com saldo total R$ 2.368.211,67 (±0,10) e os 6 credores ativos + 3 encerrados.
5. Subir a mesma planilha de novo → erro 409 "Todos os credores da planilha já foram importados e aprovados." e nenhum lote novo na lista.

Se algo divergir, corrigir antes de commitar; se o Marcelo preferir revisar com calma antes de aprovar, parar no passo 1 e deixar o lote pendente.

```bash
git add src/components/vb "src/app/(vb)/vb/importar"
git commit -m "feat(vb): telas de importação com revisão e aprovação do lote

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Extrato do credor e Novo lançamento

**Files:**
- Create: `src/lib/vb/actions/entries.ts`
- Create: `src/components/vb/new-entry-dialog.tsx`
- Create: `src/app/(vb)/vb/credores/[id]/page.tsx`

**Interfaces:**
- Consumes: `getVbUser`, `requireVbGestor` (Task 2); `getCreditor`, `listEntries`, `countPendingEntries`, `getPendingBatch` (Task 6); `groupByYear`, `ledgerTotals`, `currentBalance` (Task 5); `describeRendimento` (Task 5); `diffDaysIso` (Task 4); `roundCents` (Task 4); `VbActionResult`, `VB_KIND_LABELS` (Task 1); `formatBRL`, `parseBrNumber` (`@/lib/orcamento/format`); `formatDayBR` (`@/lib/ctrl/datetime`).
- Produces: `createVbEntry(input: NewEntryInput)`, `VbNewEntryDialog`.

- [ ] **Step 1: Action — `src/lib/vb/actions/entries.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireVbGestor } from "@/lib/vb/auth";
import { diffDaysIso } from "@/lib/vb/import/excel-date";
import { roundCents } from "@/lib/vb/money";
import type { VbActionResult } from "@/lib/vb/types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const newEntrySchema = z.object({
  creditor_id: z.string().uuid("Credor inválido."),
  entry_date: z.string().regex(ISO_DATE, "Data inválida."),
  kind: z.enum(["entrada", "saida", "rendimento"]),
  /** Com sinal já aplicado pelo formulário (entrada +, saída −, rendimento ±). */
  amount: z.number(),
  description: z.string().trim().max(300, "Descrição longa demais.").nullable(),
  period_start: z.string().regex(ISO_DATE, "Início do período inválido.").nullable(),
  period_end: z.string().regex(ISO_DATE, "Fim do período inválido.").nullable(),
  /** Fração (0.0335 = 3,35%). */
  rate: z.number().nullable(),
  rate_basis: z.enum(["periodo", "ajuste"]).nullable(),
});

export type NewEntryInput = z.infer<typeof newEntrySchema>;

/**
 * Lançamento manual do gestor. Entra direto como 'aprovado' — a revisão é só
 * para a importação. O histórico aprovado não é editável nesta fase.
 */
export async function createVbEntry(input: NewEntryInput): Promise<VbActionResult<{ id: string }>> {
  const user = await requireVbGestor();
  const parsed = newEntrySchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const v = parsed.data;

  const amount = roundCents(v.amount);
  if (amount === 0) return { error: "Valor não pode ser zero." };
  if (v.kind === "entrada" && amount < 0) return { error: "Entrada precisa ser positiva." };
  if (v.kind === "saida" && amount > 0) return { error: "Saída precisa ser negativa." };

  let period_start: string | null = null;
  let period_end: string | null = null;
  let days: number | null = null;
  let rate: number | null = null;
  let rate_basis: "periodo" | "ajuste" | null = null;
  if (v.kind === "rendimento") {
    period_end = v.period_end ?? v.entry_date;
    period_start = v.period_start ?? period_end;
    if (period_start > period_end) return { error: "Início do período depois do fim." };
    days = diffDaysIso(period_start, period_end);
    rate = v.rate;
    rate_basis = v.rate_basis ?? (rate == null ? "ajuste" : "periodo");
  }

  const admin = createAdminClient();
  const { data: creditor, error: creditorError } = await admin
    .from("vb_creditors")
    .select("id")
    .eq("id", v.creditor_id)
    .maybeSingle();
  if (creditorError) return { error: creditorError.message };
  if (!creditor) return { error: "Credor não encontrado." };

  const { data, error } = await admin
    .from("vb_entries")
    .insert({
      creditor_id: v.creditor_id,
      entry_date: v.entry_date,
      kind: v.kind,
      amount,
      description: v.description || null,
      period_start,
      period_end,
      days,
      rate,
      rate_basis,
      status: "aprovado",
      sort_order: 0,
      flags: [],
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Falha ao gravar." };

  revalidatePath("/vb");
  revalidatePath(`/vb/credores/${v.creditor_id}`);
  return { ok: true, id: data.id as string };
}
```

- [ ] **Step 2: Diálogo — `src/components/vb/new-entry-dialog.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";

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
import { parseBrNumber } from "@/lib/orcamento/format";
import { createVbEntry } from "@/lib/vb/actions/entries";
import { VB_KIND_LABELS, type VbEntryKind } from "@/lib/vb/types";

const SELECT_CLS =
  "h-9 w-full rounded-md border border-border bg-surface-1 px-3 text-sm text-ink-primary outline-none focus:ring-2 focus:ring-teal-500/40";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function VbNewEntryDialog({ creditorId, creditorName }: { creditorId: string; creditorName: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(todayIso());
  const [kind, setKind] = useState<VbEntryKind>("entrada");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [ratePct, setRatePct] = useState("");
  const [basis, setBasis] = useState<"periodo" | "ajuste">("periodo");

  function reset() {
    setDate(todayIso());
    setKind("entrada");
    setAmount("");
    setDescription("");
    setPeriodStart("");
    setPeriodEnd("");
    setRatePct("");
    setBasis("periodo");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const raw = parseBrNumber(amount);
    if (raw == null || Number.isNaN(raw)) {
      showToast({ title: "Valor inválido", variant: "destructive" });
      return;
    }
    const rate = ratePct.trim() ? parseBrNumber(ratePct) : null;
    if (rate != null && Number.isNaN(rate)) {
      showToast({ title: "Taxa inválida", variant: "destructive" });
      return;
    }
    const signed = kind === "entrada" ? Math.abs(raw) : kind === "saida" ? -Math.abs(raw) : raw;
    startTransition(async () => {
      const result = await createVbEntry({
        creditor_id: creditorId,
        entry_date: date,
        kind,
        amount: signed,
        description: description.trim() || null,
        period_start: kind === "rendimento" && periodStart ? periodStart : null,
        period_end: kind === "rendimento" ? periodEnd || date : null,
        rate: kind === "rendimento" && rate != null ? rate / 100 : null,
        rate_basis: kind === "rendimento" ? basis : null,
      });
      if ("error" in result) {
        showToast({ title: "Não gravado", description: result.error, variant: "destructive" });
        return;
      }
      showToast({ title: "Lançamento gravado", variant: "success" });
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-4 w-4" /> Novo lançamento
      </Button>
      <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
        <DialogContent>
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Novo lançamento — {creditorName}</DialogTitle>
              <DialogDescription>
                Entra direto no extrato. Rendimento negativo é aceito (ajuste), mas confira o sinal.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="vb-new-date">Data</Label>
                <Input id="vb-new-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="vb-new-kind">Tipo</Label>
                <select id="vb-new-kind" className={SELECT_CLS} value={kind} onChange={(e) => setKind(e.target.value as VbEntryKind)}>
                  {(Object.keys(VB_KIND_LABELS) as VbEntryKind[]).map((k) => (
                    <option key={k} value={k}>{VB_KIND_LABELS[k]}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="vb-new-amount">Valor (R$)</Label>
                <Input id="vb-new-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1.000,00" required />
              </div>
              <div>
                <Label htmlFor="vb-new-desc">Descrição</Label>
                <Input id="vb-new-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
              </div>
              {kind === "rendimento" && (
                <>
                  <div>
                    <Label htmlFor="vb-new-ps">Início do período</Label>
                    <Input id="vb-new-ps" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="vb-new-pe">Fim do período</Label>
                    <Input id="vb-new-pe" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} placeholder={date} />
                  </div>
                  <div>
                    <Label htmlFor="vb-new-rate">Taxa no período (%)</Label>
                    <Input id="vb-new-rate" inputMode="decimal" value={ratePct} onChange={(e) => setRatePct(e.target.value)} placeholder="3,35" />
                  </div>
                  <div>
                    <Label htmlFor="vb-new-basis">Método</Label>
                    <select id="vb-new-basis" className={SELECT_CLS} value={basis} onChange={(e) => setBasis(e.target.value as "periodo" | "ajuste")}>
                      <option value="periodo">Saldo × taxa do período</option>
                      <option value="ajuste">Ajuste manual</option>
                    </select>
                  </div>
                </>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Gravar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 3: Página do extrato — `src/app/(vb)/vb/credores/[id]/page.tsx`**

```tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft } from "lucide-react";

import { VbNewEntryDialog } from "@/components/vb/new-entry-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDayBR } from "@/lib/ctrl/datetime";
import { formatBRL } from "@/lib/orcamento/format";
import { createClient } from "@/lib/supabase/server";
import { getVbUser } from "@/lib/vb/auth";
import { describeRendimento } from "@/lib/vb/format";
import { currentBalance, groupByYear, ledgerTotals } from "@/lib/vb/ledger";
import { countPendingEntries, getCreditor, getPendingBatch, listEntries } from "@/lib/vb/queries";

export const dynamic = "force-dynamic";

function Stat({ label, value, negative }: { label: string; value: number; negative?: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-ink-muted">{label}</CardTitle>
      </CardHeader>
      <CardContent className={`text-2xl font-semibold ${negative ? "text-red-600" : "text-ink-primary"}`}>
        {formatBRL(value)}
      </CardContent>
    </Card>
  );
}

export default async function VbCreditorPage({ params }: { params: { id: string } }) {
  const user = await getVbUser();
  if (!user) redirect("/");
  const isGestor = user.role === "gestor";
  const db = await createClient();

  const creditor = await getCreditor(db, params.id);
  if (!creditor) notFound();

  const [entries, pendingCount, pendingBatch] = await Promise.all([
    listEntries(db, { status: "aprovado", creditorId: creditor.id }),
    isGestor ? countPendingEntries(db, creditor.id) : Promise.resolve(0),
    isGestor ? getPendingBatch(db) : Promise.resolve(null),
  ]);

  const totals = ledgerTotals(entries);
  const balance = currentBalance(entries);
  const years = groupByYear(entries);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/vb" className="inline-flex items-center gap-1 text-xs text-ink-muted hover:underline">
            <ArrowLeft className="h-3 w-3" /> Visão geral
          </Link>
          <h1 className="text-xl font-semibold text-ink-primary">
            {creditor.name}
            {!creditor.active && <Badge variant="secondary" className="ml-2 align-middle">encerrado</Badge>}
          </h1>
          <p className="text-sm text-ink-muted">
            {entries.length} lançamentos · saldo positivo = o VB deve ao credor
          </p>
        </div>
        {isGestor && <VbNewEntryDialog creditorId={creditor.id} creditorName={creditor.name} />}
      </div>

      {isGestor && pendingCount > 0 && (
        <div className="flex items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <span className="text-ink-primary">
            {pendingCount} lançamento(s) deste credor aguardam aprovação e não entram no saldo.
          </span>
          {pendingBatch && (
            <Link href={`/vb/importar/${pendingBatch.id}`} className="ml-auto font-medium underline">
              Revisar lote
            </Link>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Saldo atual" value={balance} negative={balance < 0} />
        <Stat label="Entradas" value={totals.entradas} />
        <Stat label="Saídas" value={totals.saidas} />
        <Stat label="Rendimentos" value={totals.rendimentos} />
      </div>

      {years.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-ink-muted">Nenhum lançamento aprovado.</CardContent>
        </Card>
      ) : (
        years.map((group) => (
          <Card key={group.year}>
            <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-2">
              <CardTitle className="text-base">{group.year}</CardTitle>
              <p className="text-xs text-ink-muted">
                Entradas {formatBRL(group.totals.entradas)} · Saídas {formatBRL(group.totals.saidas)} · Rendimentos{" "}
                {formatBRL(group.totals.rendimentos)} · Saldo no fim do ano{" "}
                <strong className="text-ink-primary">{formatBRL(group.closingBalance)}</strong>
              </p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="text-right">Entrada</TableHead>
                      <TableHead className="text-right">Saída</TableHead>
                      <TableHead className="text-right">Rendimento</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.entries.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap">{formatDayBR(row.entry_date)}</TableCell>
                        <TableCell>
                          <div>{row.description ?? "—"}</div>
                          {row.kind === "rendimento" && (
                            <div className="text-xs text-ink-muted">{describeRendimento(row)}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{row.kind === "entrada" ? formatBRL(row.amount) : ""}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.kind === "saida" ? formatBRL(Math.abs(row.amount)) : ""}</TableCell>
                        <TableCell className={`text-right tabular-nums ${row.kind === "rendimento" && row.amount < 0 ? "text-red-600" : ""}`}>
                          {row.kind === "rendimento" ? formatBRL(row.amount) : ""}
                        </TableCell>
                        <TableCell className={`text-right font-medium tabular-nums ${row.balance < 0 ? "text-red-600" : ""}`}>
                          {formatBRL(row.balance)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 4: Lint, build, navegador e commit**

Run: `npm run lint && npm run build`

No navegador (Marcelo logado): abrir o extrato do Pedro P a partir da Visão geral. Esperado: saldo atual R$ 331.092,83 (±0,05), anos de 2026 até 2017, a linha do rendimento de 01/01 a 31/03/2026 com "89 dias · 3,35% no período". Clicar "Novo lançamento", gravar uma entrada de R$ 1,00 com descrição "TESTE — apagar", conferir que aparece em 2026 e que o saldo subiu R$ 1,00; depois remover a linha de teste com `mcp__claude_ai_Supabase__execute_sql`:

```sql
DELETE FROM public.vb_entries WHERE description = 'TESTE — apagar' AND import_batch_id IS NULL;
```

(é DELETE: mostrar ao Marcelo e esperar "ok").

```bash
git add src/lib/vb/actions/entries.ts src/components/vb/new-entry-dialog.tsx "src/app/(vb)/vb/credores"
git commit -m "feat(vb): extrato por credor agrupado por ano e lançamento manual

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Documentação no CLAUDE.md e verificação final

**Files:**
- Modify: `CLAUDE.md` (nova seção depois de "### Módulo Validação de Contratos (`/contratos`)")

- [ ] **Step 1: Seção no CLAUDE.md**

Inserir, logo antes da linha `- `mapeamento` and `configuracoes` are **admin-only** even for other DRE users.`:

```markdown
### Módulo VB (`/vb`, Viva Bank)

Controle dos créditos de sócios/credores que emprestaram ao grupo na construção do Terrazzo — substitui a planilha `docs/VB TERRAZZO V2.xlsx`. Desenho: `docs/superpowers/specs/2026-09-09-vb-viva-bank-design.md`.

- **Acesso só por concessão**: linha em `user_module_roles` (`module='vb'`, `role` `gestor` | `credor`), lida por `src/lib/auth/vb.ts`. **Admin não passa por cima** (mesma filosofia das empresas restritas): sem a linha, o grupo VB não aparece no menu e `/vb` redireciona. O gate em `canAccessPathByProfile` vem antes de "Admin: tudo" de propósito. Hoje só o Marcelo tem `gestor`; a tela de Usuários ainda não oferece o botão (fase 2, junto com o papel `credor`, que verá só o próprio extrato via `vb_creditors.user_id`).
- **Histórico congelado**: cada linha da planilha virou um lançamento com o valor que estava lá (`rate_basis` registra o método: `mensal` = taxa fixa capitalizada por dia, `periodo` = saldo × CDI do período, `ajuste` = valor digitado). O sistema não recalcula juros do passado — os saldos são fatos acordados com cada credor.
- **Saldo nunca é gravado**: é a soma de `vb_entries.amount` (com sinal) em ordem `(entry_date, sort_order, created_at)` — `src/lib/vb/ledger.ts`. Só `status='aprovado'` entra em saldo e totais.
- **Importação com revisão**: `POST /api/vb/import` parseia o `.xlsx` (`src/lib/vb/import/parse-vb-workbook.ts`, função pura) e grava os lançamentos como `pendente` na própria `vb_entries`, num `vb_import_batches` (um pendente por vez). A revisão compara o SALDO da planilha (`sheet_balance`) com o saldo somado; até R$ 1,00 é arredondamento. Aprovar (`vb_approve_import_batch`, transação) exige zero flags bloqueantes (`data_invalida`, `valor_invalido`). Credor com lançamento aprovado nunca é reimportado. `npx tsx scripts/vb-parse-check.ts` confere a planilha real sem tocar o banco.
- Escrita nas tabelas `vb_*` só pelo admin client depois de `requireVbGestor()` (`src/lib/vb/auth.ts`); leitura das páginas pelo client do usuário sob RLS (`vb_role()`).
- Fases seguintes previstas no modelo, não construídas: juros automáticos com CDI do Banco Central (`rate_basis='cdi'`), importação de lançamentos da Omie, edição de lançamentos aprovados.
```

Também na seção "## Database", na lista de tabelas, adicionar ao final da lista DRE/Access: `- **VB** (prefixed `vb_*`): creditors, entries, import_batches.`

- [ ] **Step 2: Verificação final**

Run, nesta ordem, e anotar o resultado de cada um:

```bash
npm test
npm run lint
npm run build
npx tsx scripts/vb-parse-check.ts
```

`mcp__claude_ai_Supabase__get_advisors` (security): sem alerta novo para `vb_*` além do predicado `vb_role`.

Roteiro no navegador (Marcelo logado), se ainda não feito nas Tasks 8 e 9: menu VB → Importação → upload → revisão (renomear Mylliano) → aprovar → Visão geral (saldo total R$ 2.368.211,67 ±0,10; Mylliano negativo em vermelho; Fabio/Mirai/Renan como encerrados) → extrato do Vitor (saldo R$ 781.589,42 ±0,05) → novo lançamento e remoção da linha de teste. Depois, com outro admin (ou removendo e recolocando a linha de `user_module_roles` do Marcelo): VB some do menu e `/vb` volta para `/`.

- [ ] **Step 3: Commit e entrega**

```bash
git add CLAUDE.md
git commit -m "docs: módulo VB no CLAUDE.md

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Terminar com o skill `superpowers:finishing-a-development-branch` (merge de `feat/vb-module` em `main` é decisão do Marcelo).

## Fora do plano (anotar, não fazer)

- `scripts/apply-migration.js` tem uma chave `service_role` do Supabase em texto claro, commitada. Não faz parte do VB; avisar o Marcelo para rotacionar a chave e remover o arquivo (ver memória "Repo público + credencial Omie vazada").
