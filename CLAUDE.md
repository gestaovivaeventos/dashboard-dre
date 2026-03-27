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

**Stack**: Next.js 14 (App Router) + TypeScript + Supabase (Auth + Postgres) + shadcn/ui + Tailwind CSS. Deployed on Vercel with Cron Jobs.

**What it does**: Financial dashboard (DRE - Income Statement) that syncs data from Omie ERP, maps Omie categories to DRE accounts, calculates KPIs, and provides multi-company consolidation.

### Data Flow

```
Omie ERP API → financial-processor.ts (11 rules) → financial_entries table
                                                          ↓
                                            dre.ts (aggregation + formulas)
                                                          ↓
                                              Dashboard / KPIs / PDF export
```

### Key Directories

- `src/app/(app)/` — Protected pages (dashboard, kpis, conexoes, mapeamento, configuracoes, usuarios)
- `src/app/api/` — API routes (auth, companies, sync, cron, dre-accounts, category-mapping, kpi-definitions, users, dashboard, export)
- `src/lib/auth/` — Session management (`session.ts`) and role-based access (`access.ts`)
- `src/lib/omie/` — Omie integration: sync orchestration (`sync.ts`) and the 11-rule financial processor (`financial-processor.ts`)
- `src/lib/dashboard/` — DRE calculation engine (`dre.ts`)
- `src/lib/kpi/` — KPI formula evaluation (`calc.ts`)
- `src/lib/security/` — AES-256-GCM encryption for Omie credentials (`encryption.ts`)
- `src/lib/supabase/` — Supabase client setup and generated types
- `src/components/app/` — Domain-specific components
- `src/components/ui/` — shadcn/ui primitives
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

## Authentication & Authorization

- Supabase Auth with HTTP-only cookies, session refresh in middleware
- Three roles: `admin`, `gestor_hero`, `gestor_unidade`
- Access rules defined in `src/lib/auth/access.ts` (`PAGE_ACCESS_RULES`)
- `getCurrentSessionContext()` returns user + profile with role — used by both pages and API routes
- First user auto-promoted to admin in dev mode

| Role | dashboard | kpis | conexoes | mapeamento | configuracoes | usuarios |
|------|-----------|------|----------|------------|---------------|----------|
| admin | yes | yes | yes | yes | yes | yes |
| gestor_hero | yes | yes | yes | no | no | no |
| gestor_unidade | yes | yes | no | no | no | no |

## Database

Key tables: `users`, `companies`, `dre_accounts`, `financial_entries`, `category_mappings`, `kpi_definitions`, `sync_logs`.

SQL functions: `get_dre_consolidated()` (account aggregation), `get_dre_drilldown()` (transaction detail).

Omie credentials (app_key/app_secret) are encrypted with AES-256-GCM before storage, decrypted on-demand for API calls.

## Deployment

Vercel with a cron job at `0 6 * * *` (06:00 UTC / 03:00 BRT) hitting `/api/cron/sync-all` with Bearer token auth (`CRON_SECRET`). Sends email alerts (via Resend) on sync failures and unmapped categories.

## Environment Variables

Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`, `RESEND_API_KEY`, `ADMIN_EMAIL`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL`.

`ENCRYPTION_KEY` is used for AES-256-GCM encryption of Omie credentials. Changing it after data is encrypted will break decryption — restore original key or re-enter credentials.

## Conventions

- User-facing text and error messages in Portuguese
- Technical/debug messages in English
- Pages are async server components; interactive UI uses `"use client"`
- API routes return `{ error: string }` with appropriate HTTP status on failure
- Database migrations are timestamped and applied in order via `supabase db push`
- Omie API rate limit: 350ms between calls (`REQUEST_INTERVAL_MS`)
