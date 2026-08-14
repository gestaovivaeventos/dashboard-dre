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

### Manual do módulo Compras — `src/lib/ctrl/manual/content.ts`

O manual do usuário final (fluxo, alçadas, status, o que cada perfil faz) tem **fonte única** nesse arquivo de dados puro. Dele saem as duas versões: a tela `/ctrl/manual` (`manual-client.tsx`, último item do menu COMPRAS, liberada a qualquer papel do módulo) e o arquivo Word em `docs/`, gerado por `npx tsx scripts/gen-manual-doc.ts` (`manual/word.ts` renderiza HTML/MSO — não há lib de .docx no projeto). O Word é distribuído **fora do app**: a tela não oferece download, e a rota que servia esse botão foi removida a pedido.

**Ao mudar uma regra do módulo (fluxo, alçada, status, campo obrigatório, trava), atualize a seção correspondente do manual** — ele é lido pelo usuário como se fosse a regra, e um manual desatualizado gera mais chamado do que manual nenhum.

## Authentication & Authorization

- Supabase Auth with HTTP-only cookies; session refreshed in `src/lib/supabase/middleware.ts`.
- `getSessionContext()` (in `session.ts`) is the single entry point — returns `{ user, profile, modules }`. The `users` row is created by the `on_auth_user_created` trigger on signup; no row → empty session → `/pendente`.
- First user auto-promoted to admin **in dev mode only**.

### Two role models live side by side (mid-migration)

The schema is transitioning from the old flat-role model to a **profile + per-module** model. Both exist; know which you're touching:

- **New model (authoritative for pages)** — `canAccessPathByProfile(pathname, profile, canFinanceiro, canCompras, canCase, canViagens, email)`. `profile` is a `UserProfileType`: `admin`, `franqueado`, `csc`, `validador_contrato`, plus CTRL profiles `solicitante`, `gerente`, `gerente_setor`, `diretor`, `contas_a_pagar`. `csc` ("CSC") is a functional copy of `franqueado` ("Visão Financeira") plus the *Validação Relatório* screen — change one only after deciding whether the other follows. Module access is two booleans (`can_financeiro`, `can_compras`). `defaultLandingFor(...)` decides post-login redirect.
- **Legacy model** — `canAccessPath(pathname, dreRole, ctrlRole)` with `DreRole` (`admin`/`gestor_hero`/`gestor_unidade`) and `CtrlRole`. Still called by older code; tables `DRE_RULES` / `CTRL_RULES` / `SEGMENT_SUB_RULES` back it. Will be removed once all callers migrate.

Session helpers: `hasDreAccess(ctx, minRole?)` (hierarchy `gestor_unidade < gestor_hero < admin`), `hasCtrlAccess(ctx, roles?)`. In CTRL server actions use `requireCtrlRole(...allowed)` / `getCtrlUser()` from `src/lib/ctrl/auth.ts`.

Special profiles to remember:
- `franqueado` — explicit **whitelist** of DRE view screens (dashboard, fluxo-de-caixa, budget-forecast, kpis, business-intelligence, documentos), at both `/...` and `/s/<slug>/...`. Everything else (conexões, mapeamento, configurações, admin, ctrl, contratos, usuarios) is denied.
- `validador_contrato` — island: only `/contratos*`. Continua existindo, mas **não é mais o único caminho** para a tela — ver o módulo Validação de Contratos abaixo.

### Regras nominais (exceções por usuário fixas no código)

Alguns acordos de negócio não têm campo de cadastro e vivem no código: alçada de aprovação restrita e roteamento fixo (`src/lib/ctrl/routing.ts`), visão completa do Compras (`src/lib/ctrl/full-view.ts`) e a liberação da Validação Relatório (`src/lib/auth/bi-validation.ts`).

`src/lib/auth/user-exceptions.ts` é a **vitrine** dessas regras: não define nada, apenas lê as fontes acima e as descreve em português. A tela de Usuários usa isso em dois lugares — um ícone âmbar na linha de quem tem exceção e o botão "Regras especiais" no cabeçalho, que abre o catálogo completo. O catálogo também aponta **regras órfãs** (e-mail/ID do código que não existe mais na base), que de outro modo deixariam de valer em silêncio.

**Ao criar uma regra nominal nova, registre a leitura dela em `user-exceptions.ts`** — senão ela volta a ser invisível para quem administra os usuários, que é exatamente o problema que essa tela resolve.

### Módulo Validação de Contratos (`/contratos`)

`src/lib/auth/contratos.ts` é a fonte de verdade. A tela deixou de ser exclusiva do perfil `validador_contrato` (que isolava o usuário) e virou um **módulo** marcável em "Módulos visíveis" na tela de Usuários — assim um Gerente Sócio do Compras, por exemplo, pode validar contratos sem trocar de perfil.

A concessão é gravada numa linha de `user_module_roles` (`module='contratos'`, `role='validador'`), **não** numa coluna `can_contratos` em `users`. Foi decisão consciente: coluna nova exigiria migration, e enquanto ela não roda o `select` explícito de `getSessionContext` quebra inteiro (42703) e derruba o app. A sessão expõe o resultado como `profile.can_contratos`, então o resto do código lê como se fosse mais uma flag de módulo. Quem lê a flag precisa ler a linha: `getSessionContext`, o middleware e a root page (`/`) fazem o mesmo join. `validador_contrato` (e o flag legado `contracts_only`) continua implicando o módulo, então ninguém perde acesso.

As policies de `contract_validation_batches` / `_items` só conhecem `is_admin()` / `is_hero_manager()` — como o módulo agora pode cair em qualquer perfil, as páginas `/contratos` leem com service role (mesmo padrão que `/api/contracts/batches` já usava), depois de checarem `profile.can_contratos`.

O módulo é liberável em **qualquer perfil**, inclusive `franqueado` ("Visão Financeira") e `csc` — que escondiam a seção "Módulos visíveis" inteira por serem só-Financeiro e hoje mostram só esse botão. Duas ordens importam por causa disso: em `canAccessPathByProfile` o gate de `/contratos` vem **antes** do bloco franqueado/CSC (a whitelist deles negaria a rota), e em `nav-links.tsx` o item é decidido **antes** de `FRANQUEADO_NAV_KEYS`/`CSC_NAV_KEYS`. Só `admin` (tem tudo) e `validador_contrato` (é o próprio módulo) seguem sem a seção.

No menu, a tela tem grupo próprio (`CONTRATOS`); saiu de PLATAFORMA, onde convivia com as telas de administração sem ter relação com elas.

"Viagens" saiu de "Módulos visíveis" (módulo sem uso). As colunas `can_viagens`/`can_viagens_aprovar`, o módulo e o kill-switch `VIAGENS_ENABLED` continuam existindo; o formulário só carrega e devolve os valores atuais, sem oferecê-los.
- `mapeamento` and `configuracoes` are **admin-only** even for other DRE users.

## Database

- **DRE**: `users`, `companies`, `segments`, `dre_accounts`, `financial_entries`, `category_mappings`, `kpi_definitions`, `sync_logs`, `dre_monthly_aggregates`, `cash_flow_*` (accounts, category mappings, monthly aggregates), `*_manual_entries`, `company_documents`, contract tables.
- **Access**: `user_module_roles`, `user_company_access`, `user_segment_access`, `user_sectors`.
- **CTRL** (prefixed `ctrl_*`): requests, suppliers, sectors, events, budgets, omie-mapping, notifications, contapagar launches, `ctrl_approval_email_log` (rastro + trava de duplicidade do lembrete diário de aprovações). Note: `contas_a_pagar` absorbs the legacy `csc` concept in-app — RLS policies that list `csc` must also include `contas_a_pagar`.

SQL functions: `get_dre_consolidated()` (account aggregation), `get_dre_drilldown()` (transaction detail), plus aggregate-refresh functions.

Omie credentials (app_key/app_secret) are encrypted with AES-256-GCM before storage, decrypted on-demand for API calls.

**Migrations**: timestamped, applied in order. `schema_migrations` records the *application* timestamp, which does **not** match the file-name prefix — match migrations by name, not by timestamp. Per Marcelo's global instructions, run DDL/DML yourself via the Supabase MCP or CLI rather than pasting SQL for him to run.

## Deployment

Vercel. Cron jobs (`vercel.json`):
- `/api/cron/sync-all` — `0 6 * * *` (06:00 UTC / 03:00 BRT). Omie sync. **On the BI generation day (BRT) it syncs the last 6 months** instead of the 3-day rolling window, so retroactive entries land before the monthly reports are generated. Emails admin on sync failures and unmapped categories.
- `/api/cron/process-contracts` — `*/2 * * * *`. Drains the contract-extraction batch queue.
- `/api/cron/bi-monthly-validation` — `0 12 5 * *` (12:00 UTC / **09:00 BRT**). Generates the previous month's BI report per company (only companies with recipients in `bi_report_subscriptions` **and** `sync_enabled` not false — unidade fora do pacote não entra no ciclo), stores it in `bi_report_validations` as `pendente_validacao`, and notifies CSC users. **Does not send.**
- `/api/cron/bi-monthly-autosend` — `0 12 11 * *` (12:00 UTC / **09:00 BRT** — cron da Vercel é sempre UTC; não é meio-dia de Brasília). Sends (via Resend) every previous-month report still unsent. Reports `em_revisao` or without content are *not* sent — they raise an admin alert instead. Destinatário é resolvido **no momento do envio**, então mexer na lista em Plataforma > Relatório BI depois da geração muda quem recebe; empresa que ficou sem destinatário falha o envio.
- `/api/cron/ctrl-approval-reminders` — `0 13 * * 1-5` (13:00 UTC / **10:00 BRT, segunda a sexta**). Lembrete diário de aprovações do módulo Compras (ver abaixo).
- `/api/cron/monthly-report` — AI monthly executive report (invoked on schedule/manually).

Os dois dias da rotina (geração e envio automático) vivem em `src/lib/financeiro/relatorios/schedule.ts` — `BI_GENERATION_DAY` / `BI_AUTOSEND_DAY`. Todo texto de tela, notificação e e-mail lê de lá; **o cron não lê constante**, então mudar um dia exige editar `vercel.json` junto (e conferir que a janela de 6 meses do `sync-all` casa com o dia da geração). Não escreva o número do dia à mão em texto novo.

There is **no direct dispatch**. The legacy `/api/cron/monthly-bi-report` (direct send to `bi_report_subscriptions`, bypassing validation) was deleted — do not recreate it. `/admin/relatorios-bi` ("Relatórios BI") now only defines *who receives*; the validation flow below is the official send. The one remaining bypass is the admin-only `POST /api/bi-subscriptions/send` ("Enviar agora"), kept as manual contingency for a single manager.

### BI report validation flow (CSC)

`Financeiro > Validação Relatório` (`/financeiro/validacao-relatorio`) is the human gate between generation and delivery. Access whitelist lives in `src/lib/auth/bi-validation.ts` (profile `csc`, admin, and two named e-mails) and is mirrored by `public.can_validate_bi_reports()` in RLS. Actions: **Aceitar** (unlocks 1-click send), **Revisão** (blocks send, records who/when/why), **Adicionar contexto** (free text → re-runs the AI analysis with the context; numbers never change), **Histórico de contexto** (read-only list of every context ever added to that company × month — text, author, timestamp, and the report version it was applied to; served by `GET /api/bi-validation/[id]/contextos` from `bi_report_validation_contexts`). Context **accumulates**: each new text is appended to `extra_context`, so the history is what tells the CSC what is already in the prompt. The history stays available after the send and when generation failed.

**O contexto também RETIFICA, não só complementa.** `CONTEXTO_CONTROLADORIA_RULE` manda a IA reler os próprios alertas e ações depois de ler o contexto: alerta que o contexto desmonta não é gerado; alerta que sobrevive vem com a ressalva no próprio texto (inclusive quando a causa reaparece dentro de um alerta agregado, ex.: "receita líquida abaixo do orçado, impactada por formaturas"); ação já tomada ou desnecessária sai da lista, trocada pelo próximo passo real; severidade é recalibrada. A regeneração é **stateless** — a IA não vê a versão anterior do relatório, então o contexto precisa descrever o problema ("não havia formatura prevista em julho; o orçamento foi rateado linearmente"), não apenas apontar o item ("o alerta 2 está errado").

**O contexto vive dentro do `diagnosticoPrincipal` — não crie um bloco só para ele.** É o único texto que todo template renderiza (`show("diagnostico")` vale para todos, e Viva/genérico nem filtram blocos), por isso o prompt manda escrever de 3 a 5 frases costurando leitura do período + explicação num texto único; o cap do campo é 900 chars por causa disso. Um bloco separado ("Contexto do período") chegou a existir e foi removido: o texto aparecia duas vezes, já que o diagnóstico também o traz. Cuidado ao mandar a explicação para outros campos: `destaques` só chega ao leitor pelo bloco de alertas, que prioriza riscos e **corta em 3 cards** (`mapAlertas`), e `leituraPorIndicador`/`justificativa` não são renderizados em lugar nenhum.

**Custos variáveis lidos junto com a receita (7 empresas).** `custos-variaveis-receita.ts` decide se `CUSTOS_VARIAVEIS_RECEITA_RULE` entra no system prompt. Em Sirena, Terrazzo, Salvaterra Estacionamento, SGX, Village, Spot e Express, Custos de Serviços Prestados + IRPJ/CSLL/PIS/COFINS são **variáveis**: com a receita abaixo do orçado, a queda deles é consequência do faturamento que não ocorreu, não economia — sem a regra o `SHARED_TAIL` ("custo abaixo do orçado = FAVORÁVEL") fazia a IA celebrar como eficiência o reflexo de uma receita que não aconteceu. A regra **não** move essas linhas para `pontosAtencao` (o alerta continua sendo a receita, nunca o custo que deixou de ocorrer) e não alcança as despesas operacionais fixas. O gate é uma **allowlist própria, não uma flag em `ReportTemplate`**: a Express não tem template e cai no `genericTemplate`, compartilhado com toda empresa sem template — uma flag ligaria a regra para todas elas. A blocklist (Franquias Viva inteiro, Case Shows, Feat, Young Med, Salvaterra Condomínio) é redundante de propósito e falha fechada.

**O contexto precisa ser autorizado no system prompt, não só anexado ao user prompt.** O `SHARED_TAIL` de `one-page-prompt.ts` manda, em "REGRAS INVIOLÁVEIS", nunca citar eventos/nomes fora do JSON e justificar ações só nos indicadores — diante do conflito o modelo obedecia a regra inviolável e **descartava** o texto do CSC (Terrazzo, jul/2026: IPTU contestado judicialmente não saiu no relatório). Por isso `resolveOnePageSystemPrompt(input, { hasBusinessContext })` anexa `CONTEXTO_CONTROLADORIA_RULE`, que abre a exceção e torna o uso obrigatório. Segue o padrão do `INDICADORES_RELATORIO_RULE`: só entra quando há contexto, então o prompt de todo relatório sem contexto continua byte a byte o mesmo. Ao endurecer as regras invioláveis, cheque se a nova regra não volta a proibir o contexto.

The e-mail is rendered from `OnePageReportPreviewData` — the *same* object the screen renders — by `one-page-email.ts`. That is what keeps the e-mail identical to the BI screen per company (block allowlist, template-exclusive blocks, hidden fields). Do not add a second renderer fed from the raw payload.

Recipients are always resolved server-side from the validation row's `company_id`; the client only sends the row id.

O **PDF** da prévia (botão "Baixar PDF", no topo do diálogo do olho) e o da tela de Business Intelligence saem do mesmo lugar: `exportOnePageReportPdf` em `src/lib/financeiro/relatorios/export-one-page-pdf.ts` — html2canvas sobre a folha `.one-page-report` já renderizada + jsPDF, com as libs em import dinâmico (ficam fora do bundle inicial). As duas telas capturam o mesmo componente, então o arquivo é idêntico; não crie um segundo exportador.

### Lembrete diário de aprovações (CTRL / Compras)

`src/lib/ctrl/approval-reminders/` + `/api/cron/ctrl-approval-reminders`. Às 10h BRT, **de segunda a sexta**, envia via Resend **um e-mail por aprovador** com todas as requisições que dependem da aprovação dele. Quem não tem pendência não recebe nada.

O fim de semana é excluído em **dois lugares de propósito**: no agendamento (`0 13 * * 1-5`) e dentro da rotina (`isWeekendBR` sobre o dia em Brasília, não em UTC — às 22h de domingo o servidor em UTC já é segunda). Assim uma execução manual num sábado também não dispara; `?force=1` é a saída consciente e `?dryRun=1` monta o conteúdo em qualquer dia.

Quem recebe o quê é derivado da mesma fonte de verdade da tela de Aprovações — não replique a regra em outro lugar:
- a **etapa vem do status**: `pendente` → gerente/gerente sócio; `pendente_diretor` → diretor. Como `applyApprovalStep` só move para `pendente_diretor` depois do aval do gerente, o diretor nunca é notificado antes da etapa gerencial;
- **notificação é sempre limitada pelo setor, inclusive para o diretor**: ele *aprova* qualquer setor (`hasGlobalVisibility`), mas só *recebe e-mail* dos setores cadastrados para ele na tela de Usuários (`user_sectors`). Decisão de negócio — não confunda com a visibilidade da tela. Gerente segue o mesmo filtro, com o fallback "sem vínculo recebe tudo" do `getRequests`;
- valem os overrides de `routing.ts`: `APPROVAL_ROUTING` (diretor/gerente fixo) e `approverSectorRestrictionFor` (alçada, falha fechada). **`DIRECTOR_HIGHLIGHT_SECTORS` agora tem dois efeitos**: além do destaque na tela, coloca o e-mail listado na etapa do diretor da rotina, restrito àqueles setores (é assim que `marcelo@quokka.net.br`, perfil admin, recebe TI / Financeiro Cash Out / Financeiro CSC / Diretoria — este último entrou em 10/08/2026 porque o setor era roteado direto ao diretor sem ninguém vinculado, e o e-mail ficava órfão);
- o pool sai de `users.profile` (`gerente`, `gerente_setor`, `diretor` + `can_compras` + `active`), **não** de `user_module_roles` — a tabela legada ainda guarda papéis de quem hoje tem outro perfil. Admin não recebe por ser admin, só via `DIRECTOR_HIGHLIGHT_SECTORS`.

`ctrl_approval_email_log` (unique `user_id` + `run_date` em BRT) é o rastro e a trava de duplicidade: reexecutar o endpoint no mesmo dia não reenvia. `?dryRun=1` monta sem enviar; `?force=1` reenvia conscientemente. Requisição pendente sem nenhum aprovador elegível não some: entra em `orphans` e vira alerta ao `ADMIN_EMAIL` — é o sintoma normal de setor sem gerente/diretor cadastrado, já que o filtro por setor não tem fallback global. A "mensagem do dia" é sorteada por hash de (usuário, dia) excluindo as últimas frases do log — determinística, então um reprocessamento repete a frase que o usuário viu.

All cron endpoints require `Authorization: Bearer <CRON_SECRET>`.

## Environment Variables

Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`, `RESEND_API_KEY`, `ADMIN_EMAIL`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL`.

O remetente do Resend tem **default no código** (`bi@contato.quokka.net.br`, domínio verificado do grupo, em `src/lib/email/resend.ts`) — `RESEND_FROM` só existe para trocá-lo. Não volte a exigir a variável: o Resend não aceita remetente genérico, então "só a chave configurada" já derrubou relatório aceito pelo CSC e a rotina de envio automático, sem que ninguém percebesse até o clique em Enviar.

Feature-specific: `OPENAI_API_KEY` (AI reports + contract LLM + Viagens web-price search), `APIDEVOOS_API_KEY` (Viagens — real flight prices via apidevoos.dev), `VISION_AGENT_API_KEY` (LandingAI contract OCR), `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON` + `FEAT_PRODUCOES_SHEET_ID`/`FEAT_PRODUCOES_SHEET_TAB` + `TERRAZZO_SHEET_ID` (Sheets sync; `TERRAZZO_SHEETS_SYNC_DISABLED` to disable).

`ENCRYPTION_KEY` is used for AES-256-GCM encryption of Omie credentials. Changing it after data is encrypted will break decryption — restore the original key or re-enter credentials.

## Conventions

- User-facing text and error messages in Portuguese
- Technical/debug messages in English
- Pages are async server components; interactive UI uses `"use client"`
- API routes return `{ error: string }` with appropriate HTTP status on failure
- Database migrations are timestamped and applied in order via `supabase db push`
- Omie API rate limit: 350ms between calls (`REQUEST_INTERVAL_MS`)
