# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server (port 3000)
npm run build        # Production build
npm run start        # Start production server
npm run lint         # ESLint
```

No test framework is configured. Validate changes with `npm run lint` and `npm run build`.

To test the cron endpoint locally:
```bash
curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/sync-all
```

## Architecture

**Stack**: Next.js 14 (App Router) + TypeScript + Supabase (Auth + Postgres + RLS) + shadcn/ui + Tailwind CSS. Deployed on Vercel with Cron Jobs. AI features use the Vercel AI SDK (`ai` + `@ai-sdk/openai`, model `gpt-4o-mini`).

**What it does**: Internal management platform for Grupo Viva, split into **two modules** that share one auth/session layer:

1. **DRE Financeiro** (`(app)` route group) — Income-statement dashboard. Syncs Omie ERP data, maps Omie categories to DRE accounts, computes KPIs, cash flow, budget/forecast, and AI-generated executive reports. Multi-company and multi-segment.
2. **Controladoria / CTRL** (`(ctrl)` route group, URLs under `/ctrl`) — Purchase-requisition + accounts-payable workflow: requests → budget check → manager/director approval → supplier registration → launch into Omie *contas a pagar*.

Both modules are gated by the same session context; a user can have access to one, both, or neither.

### DRE data flow

```
Omie ERP API → financial-processor.ts (11 rules) → financial_entries table
Google Sheets (FEAT, Terrazzo) → sheets/*-sync.ts ─┘   ↓
                              dre_monthly_aggregates / cash_flow_monthly_aggregates (materialized)
                                                          ↓
                                  dre.ts / cash-flow.ts (aggregation + formulas)
                                                          ↓
                              Dashboard / KPIs / Fluxo de Caixa / Budget / AI report / PDF export
```

`financial_entries` is the cash-basis source of truth. The `*_monthly_aggregates` tables are pre-computed rollups refreshed by `src/lib/dashboard/aggregate-refresh.ts` (with a statement-timeout guard) — read paths prefer the aggregates, not raw entries.

### Key directories

- `src/app/(app)/` — DRE pages: `home`, `dashboard`, `kpis`, `fluxo-de-caixa`, `budget-forecast`, `conexoes`, `mapeamento`, `configuracoes`, `usuarios`, `contratos`, `financeiro/`, `admin/`
- `src/app/(app)/s/[segmentSlug]/` — Same DRE screens scoped to a single **segment** (multi-tenant view). Mirrors the global pages; both URL shapes hit the same components.
- `src/app/(ctrl)/ctrl/` — Controladoria pages: `requisicoes`, `aprovacoes`, `contas-a-pagar`, `orcamento`, `relatorios`, `notificacoes`, `admin/` (eventos, fornecedores, setores, omie-mapeamento)
- `src/app/api/` — API routes. Debug-only routes live under `api/debug-*` and `api/dev/*` (not for production logic).
- `src/lib/auth/` — `session.ts` (`getSessionContext()` → user + profile + module roles) and `access.ts` (route authorization)
- `src/lib/omie/` — Omie integration: `sync.ts` (orchestration), `financial-processor.ts` (11-rule processor), `contapagar.ts` (CTRL → Omie accounts payable), `client.ts`, `cadastros.ts`, `clientes.ts`, `anexo.ts`
- `src/lib/dashboard/` — `dre.ts` (DRE engine), `cash-flow.ts`, `aggregate-refresh.ts`, `managerial-adjustments.ts`, `shared-company-filter.ts`
- `src/lib/kpi/` — KPI formula evaluation (`calc.ts`)
- `src/lib/ctrl/` — Controladoria domain: `auth.ts` (CTRL role guards), `actions/` (server actions: requests, suppliers, approvals, contapagar-launch, omie-mapping, …), `notifications.ts`, `boleto.ts`, `bancos.ts`
- `src/lib/segments/` — `resolve.ts`: resolves a segment slug + checks user access (explicit `user_segment_access` or implicit via company assignments)
- `src/lib/context/` — Active module/segment context (`active-context.ts`, `modules.ts`) — drives the header module/segment switchers
- `src/lib/contracts/` — Contract ingestion: `extract.ts`, `llm.ts`, `landingai.ts` (Vision Agent OCR), `parse-xlsx.ts`, `process-batch.ts`
- `src/lib/intelligence/` & `src/lib/financeiro/relatorios/` — AI executive reports ("one-page" analyzer, projections, comparisons) via OpenAI
- `src/lib/sheets/` — Google Sheets sync (`feat-sync.ts`, `terrazzo-sync.ts`) using a service-account credential
- `src/lib/security/` — AES-256-GCM encryption for Omie credentials (`encryption.ts`)
- `src/lib/supabase/` — client setup (`server.ts`, `client.ts`, `admin.ts`, `middleware.ts`) and generated `types.ts`
- `supabase/migrations/` — Ordered SQL migrations

### Path alias

`@/*` maps to `./src/*` (e.g., `import { X } from '@/lib/auth/session'`).

## Core Business Logic

### Financial Processor (11 Rules) — `src/lib/omie/financial-processor.ts`

Transforms raw Omie API data (ListarMovimentos) into `financial_entries`. Key decisions:
1. Period derived from `dDtPagamento` (cash basis accounting)
2. Apportionment detected when `cCodCateg1..5` are filled — uses `nDistrValor` per portion
3. Non-apportioned entries use `nValPago` or `nValLiquido`
4. BAXP/BAXR origins excluded
5. Entries grouped by period + category, then mapped via `category_mappings` table to DRE accounts
6. Processing decisions logged for audit

### DRE Calculation — `src/lib/dashboard/dre.ts`

- Aggregates `financial_entries` by `dre_account_id`
- Handles hierarchical parent/child account relationships
- Evaluates formulas for calculated accounts (`type = calculado`, `is_summary = true`)
- Computes percentages relative to net revenue (line 1 account)
- Period types: mensal, trimestral, semestral, anual, acumulado
- View modes: simples (single period), comparativa (side-by-side)

### KPI Calculation — `src/lib/kpi/calc.ts`

- Formula types: value, percentage, ratio
- Evaluation: `(numerator / denominator) * multiply_by`
- Zero denominator returns 0
- Ranking uses median across companies over 6-month rolling windows

### CTRL Requisition Workflow — `src/lib/ctrl/actions/requests.ts`

Purchase requests move through a status machine driven by a **budget check** against the sector's annual balance:
- Within budget → `pendente` (manager approval) → `pendente_diretor`? → `aprovado`
- Over budget → requires manager **and** director
- Side states: `aguardando_complementacao` (info requested), `aguardando_aprovacao_fornecedor`, `rejeitado`
Approval tier is computed from remaining annual balance at request time. Once `aprovado`, a request can be launched into Omie *contas a pagar* via `contapagar-launch.ts`. Guard every action with `requireCtrlRole(...)`.

## Authentication & Authorization

- Supabase Auth with HTTP-only cookies; session refreshed in `src/lib/supabase/middleware.ts`.
- `getSessionContext()` (in `session.ts`) is the single entry point — returns `{ user, profile, modules }`. The `users` row is created by the `on_auth_user_created` trigger on signup; no row → empty session → `/pendente`.
- First user auto-promoted to admin **in dev mode only**.

### Two role models live side by side (mid-migration)

The schema is transitioning from the old flat-role model to a **profile + per-module** model. Both exist; know which you're touching:

- **New model (authoritative for pages)** — `canAccessPathByProfile(pathname, profile, canFinanceiro, canCompras)`. `profile` is a `UserProfileType`: `admin`, `franqueado`, `validador_contrato`, plus CTRL profiles `solicitante`, `gerente`, `diretor`, `csc`, `contas_a_pagar`. Module access is two booleans (`can_financeiro`, `can_compras`). `defaultLandingFor(...)` decides post-login redirect.
- **Legacy model** — `canAccessPath(pathname, dreRole, ctrlRole)` with `DreRole` (`admin`/`gestor_hero`/`gestor_unidade`) and `CtrlRole`. Still called by older code; tables `DRE_RULES` / `CTRL_RULES` / `SEGMENT_SUB_RULES` back it. Will be removed once all callers migrate.

Session helpers: `hasDreAccess(ctx, minRole?)` (hierarchy `gestor_unidade < gestor_hero < admin`), `hasCtrlAccess(ctx, roles?)`. In CTRL server actions use `requireCtrlRole(...allowed)` / `getCtrlUser()` from `src/lib/ctrl/auth.ts`.

Special profiles to remember:
- `franqueado` — explicit **whitelist** of DRE view screens (dashboard, fluxo-de-caixa, budget-forecast, kpis, business-intelligence, documentos), at both `/...` and `/s/<slug>/...`. Everything else (conexões, mapeamento, configurações, admin, ctrl, contratos, usuarios) is denied.
- `validador_contrato` — island: only `/contratos*`.
- `mapeamento` and `configuracoes` are **admin-only** even for other DRE users.

## Database

- **DRE**: `users`, `companies`, `segments`, `dre_accounts`, `financial_entries`, `category_mappings`, `kpi_definitions`, `sync_logs`, `dre_monthly_aggregates`, `cash_flow_*` (accounts, category mappings, monthly aggregates), `*_manual_entries`, `company_documents`, contract tables.
- **Access**: `user_module_roles`, `user_company_access`, `user_segment_access`, `user_sectors`.
- **CTRL** (prefixed `ctrl_*`): requests, suppliers, sectors, events, budgets, omie-mapping, notifications, contapagar launches. Note: `contas_a_pagar` absorbs the legacy `csc` concept in-app — RLS policies that list `csc` must also include `contas_a_pagar`.

SQL functions: `get_dre_consolidated()` (account aggregation), `get_dre_drilldown()` (transaction detail), plus aggregate-refresh functions.

Omie credentials (app_key/app_secret) are encrypted with AES-256-GCM before storage, decrypted on-demand for API calls.

**Migrations**: timestamped, applied in order. `schema_migrations` records the *application* timestamp, which does **not** match the file-name prefix — match migrations by name, not by timestamp. Per Marcelo's global instructions, run DDL/DML yourself via the Supabase MCP or CLI rather than pasting SQL for him to run.

## Deployment

Vercel. Cron jobs (`vercel.json`):
- `/api/cron/sync-all` — `0 6 * * *` (06:00 UTC / 03:00 BRT). Full Omie sync; emails (Resend) on sync failures and unmapped categories.
- `/api/cron/process-contracts` — `*/2 * * * *`. Drains the contract-extraction batch queue.
- `/api/cron/monthly-report` — AI monthly executive report (invoked on schedule/manually).

All cron endpoints require `Authorization: Bearer <CRON_SECRET>`.

## Environment Variables

Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`, `RESEND_API_KEY` (+ optional `RESEND_FROM`), `ADMIN_EMAIL`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL`.

Feature-specific: `OPENAI_API_KEY` (AI reports + contract LLM + Viagens web-price search), `APIDEVOOS_API_KEY` (Viagens — real flight prices via apidevoos.dev), `VISION_AGENT_API_KEY` (LandingAI contract OCR), `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON` + `FEAT_PRODUCOES_SHEET_ID`/`FEAT_PRODUCOES_SHEET_TAB` + `TERRAZZO_SHEET_ID` (Sheets sync; `TERRAZZO_SHEETS_SYNC_DISABLED` to disable).

`ENCRYPTION_KEY` is used for AES-256-GCM encryption of Omie credentials. Changing it after data is encrypted will break decryption — restore the original key or re-enter credentials.

## Conventions

- User-facing text and error messages in Portuguese
- Technical/debug messages in English
- Pages are async server components; interactive UI uses `"use client"`
- API routes return `{ error: string }` with appropriate HTTP status on failure
- Database migrations are timestamped and applied in order via `supabase db push`
- Omie API rate limit: 350ms between calls (`REQUEST_INTERVAL_MS`)
