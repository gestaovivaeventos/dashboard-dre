# Onda 1 — Painel De-Para Omie (Control Hub) — Plano

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Painel no Control Hub para mapear, por empresa Omie, tipo de despesa → categoria, setor → departamento, e a conta OmieCash. Pré-requisito para lançar contas a pagar no Omie (Fase 2).

**Decisões:** uma empresa por vez; opções do Omie sincronizadas e guardadas em cache (botão por empresa); sem mapeamento → lançamento bloqueado (validado na Onda 3).

**Validação:** projeto sem testes — gate por `npm run build` + `npm run lint` + checagens SQL. Migração com "ok" do Marcelo.

**Spec:** docs/superpowers/specs/2026-06-09-contas-a-pagar-omie-design.md

---

## Estrutura de arquivos
- Create: `supabase/migrations/2026XXXX_ctrl_omie_mapping.sql` (4 tabelas + RLS)
- Create: `src/lib/omie/cadastros.ts` (listar categorias/departamentos/contas via `omieCall`)
- Create: `src/lib/ctrl/actions/omie-mapping.ts` (sync + get + save actions)
- Create: `src/app/(ctrl)/ctrl/admin/omie-mapeamento/page.tsx`
- Create: `src/components/ctrl/omie-mapeamento-client.tsx`
- Modify: navegação do ctrl (item de menu) + `src/lib/auth/access.ts` se necessário

---

## Task 1 — Migração (4 tabelas)
**Files:** Create `supabase/migrations/2026XXXX_ctrl_omie_mapping.sql`

- [ ] **Step 1:** Escrever migração:
```sql
-- Cache das opções do Omie por empresa (categoria, departamento, conta corrente).
CREATE TABLE IF NOT EXISTS ctrl_omie_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('categoria','departamento','conta_corrente')),
  codigo text NOT NULL,
  descricao text,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, kind, codigo)
);
CREATE INDEX IF NOT EXISTS ctrl_omie_options_company_kind_idx ON ctrl_omie_options(company_id, kind);

-- Mapeamento tipo de despesa -> categoria Omie (por empresa).
CREATE TABLE IF NOT EXISTS ctrl_expense_type_omie_categoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_type_id uuid NOT NULL REFERENCES ctrl_expense_types(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  codigo_categoria text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (expense_type_id, company_id)
);

-- Mapeamento setor -> departamento Omie (por empresa).
CREATE TABLE IF NOT EXISTS ctrl_sector_omie_departamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sector_id uuid NOT NULL REFERENCES ctrl_sectors(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  codigo_departamento text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sector_id, company_id)
);

-- Conta corrente padrão (OmieCash) por empresa para o lançamento de contas a pagar.
CREATE TABLE IF NOT EXISTS ctrl_company_omie_config (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  codigo_conta_corrente text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ctrl_omie_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE ctrl_expense_type_omie_categoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE ctrl_sector_omie_departamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE ctrl_company_omie_config ENABLE ROW LEVEL SECURITY;

-- Acesso a quem administra o módulo. Server actions usam service-role.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ctrl_omie_options','ctrl_expense_type_omie_categoria','ctrl_sector_omie_departamento','ctrl_company_omie_config']
  LOOP
    EXECUTE format($f$
      CREATE POLICY %1$s_rw ON %1$s FOR ALL
      USING (has_ctrl_role(ARRAY['admin','csc','contas_a_pagar']))
      WITH CHECK (has_ctrl_role(ARRAY['admin','csc','contas_a_pagar']));
    $f$, t);
  END LOOP;
END $$;
```
- [ ] **Step 2:** Aplicar via Supabase MCP (DASH_HERO) após "ok" do Marcelo.
- [ ] **Step 3:** Verificar existência das 4 tabelas.
- [ ] **Step 4:** Commit.

---

## Task 2 — Cliente Omie de cadastros
**Files:** Create `src/lib/omie/cadastros.ts`

- [ ] **Step 1:** Implementar, usando `omieCall` de `@/lib/omie/client`, funções paginadas:
  - `listCategorias(appKey, appSecret)` → `{ codigo, descricao }[]` (call `ListarCategorias`, endpoint `geral/categorias/`, campos a confirmar com a pesquisa de API — provável `codigo`/`descricao`).
  - `listDepartamentos(appKey, appSecret)` → `{ codigo, descricao }[]` (`ListarDepartamentos`, `geral/departamentos/`).
  - `listContasCorrentes(appKey, appSecret)` → `{ codigo, descricao }[]` (`ListarContasCorrentes`, `geral/contacorrente/`).
  Cada uma pagina (registros_por_pagina 500) até acabar. Tolerante a `notFound`.
  > NOTA: os nomes exatos de campos/calls devem ser confirmados com o relatório
  > da pesquisa da API do Omie (em andamento) antes de finalizar este arquivo.
- [ ] **Step 2:** Build. **Step 3:** Commit.

---

## Task 3 — Server actions de mapeamento
**Files:** Create `src/lib/ctrl/actions/omie-mapping.ts`

- [ ] **Step 1:** Implementar (papéis `admin`/`csc`/`contas_a_pagar`, admin client):
  - `syncOmieOptions(companyId)`: decripta credenciais da empresa, chama as 3 listas de `cadastros.ts`, faz replace do cache em `ctrl_omie_options` por (company_id, kind). Retorna contagens. Erro Omie → `{ error }`.
  - `getOmieMappingData(companyId)`: retorna `{ categorias, departamentos, contasCorrentes }` (do cache), `expenseTypeMap` e `sectorMap` (mapeamentos atuais), `contaCorrente` (config), e listas de `expenseTypes` e `sectors`.
  - `saveExpenseTypeCategoria(companyId, expenseTypeId, codigoCategoria | null)`: upsert/delete em `ctrl_expense_type_omie_categoria`.
  - `saveSectorDepartamento(companyId, sectorId, codigoDepartamento | null)`: idem em `ctrl_sector_omie_departamento`.
  - `saveContaCorrente(companyId, codigo | null)`: upsert em `ctrl_company_omie_config`.
- [ ] **Step 2:** Build. **Step 3:** Commit.

---

## Task 4 — Página + navegação
**Files:** Create `src/app/(ctrl)/ctrl/admin/omie-mapeamento/page.tsx`; Modify navegação ctrl.

- [ ] **Step 1:** Página server: gate `admin`/`csc`; carrega empresas com Omie (`companies` com `omie_app_key`/`secret`), e passa ao client. (Mapeamentos/opções são carregados via action ao escolher a empresa.)
- [ ] **Step 2:** Adicionar item de menu "Mapeamento Omie" na navegação do ctrl (admin).
- [ ] **Step 3:** Build. **Step 4:** Commit.

---

## Task 5 — Client do painel
**Files:** Create `src/components/ctrl/omie-mapeamento-client.tsx`

- [ ] **Step 1:** Implementar:
  - Seletor de empresa (dropdown das empresas com Omie).
  - Ao escolher empresa: chama `getOmieMappingData(companyId)`; se o cache estiver vazio, instrui a sincronizar.
  - Botão **"Sincronizar opções do Omie"** → `syncOmieOptions` → recarrega.
  - Seção **Conta OmieCash**: select das contas correntes (default: a que contém "omiecash"/"omie cash" no nome) → `saveContaCorrente`.
  - Seção **Tipos de despesa → Categoria**: lista os tipos de despesa, cada um com um select (buscável) das categorias; salva on-change. Indicador "X/Y mapeados".
  - Seção **Setores → Departamento**: idem com departamentos.
  - Feedback de salvo/erro; estado de loading na sincronização.
- [ ] **Step 2:** Build + lint. **Step 3:** Commit.

---

## Task 6 — Fechamento
- [ ] Build + lint finais; merge na main + push; deploy.

## Self-review (cobertura)
- 2A (tipo→categoria) → Tasks 1,3,5. 2B (setor→depto) → 1,3,5. 2C (OmieCash) → 1,3,5.
- Cache/sync → Tasks 1,2,3,5. Uma empresa por vez → Task 5.
- Bloqueio por falta de mapeamento → Onda 3 (não nesta onda).
