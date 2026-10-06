# Compras (CTRL) multiempresa — desenho da migration

**Status:** desenho aprovado para revisão — **nada aplicado, nada de código de app alterado** (exceto o fecho do `routing.ts`, já feito em 06/10/2026). Autor: Lucas + Claude. Data: 06/10/2026.

## 1. Problema

Hoje o módulo Compras é **mono-inquilino implícito**: há um único conjunto de setores, tipos de despesa, orçamento, requisições, eventos e fornecedores, e esse conjunto É o grupo **Viva Company** (5 CNPJs tratados como uma coisa só: VE Franqueadora, V Company, SPDX, Dataforte, VE Franqueadora Filial). Nada no banco diz isso — é implícito.

- `ctrl_sectors`, `ctrl_expense_types`, `ctrl_budget`, `ctrl_budget_items`, `ctrl_requests`, `ctrl_events`, `ctrl_suppliers` **não têm coluna de empresa**.
- A requisição só carrega empresa em `paying_company_id`, escolhida no Contas a Pagar.
- `user_sectors` (permissão) e as regras nominais do `routing.ts` apontam para **ids de setor** (as nominais foram fixadas por id em 06/10/2026) — nunca para empresa.
- Já é por CNPJ: o mapeamento Omie (`ctrl_company_omie_config`, `ctrl_sector_omie_departamento`, `ctrl_expense_type_omie_categoria`, `ctrl_supplier_omie`).

**Objetivo:** usar o Compras para outras empresas, a 1ª sendo a **Feat Produções**, sem impactar a Viva (dados nem permissões). O usuário resumiu o eixo: "setor é subnível da empresa; cada empresa terá seus setores".

## 2. Conceito central: a "empresa" do Compras é uma ORGANIZAÇÃO, não um CNPJ

A Viva Company é um GRUPO de 5 CNPJs que operam como uma coisa só. A Feat é 1 CNPJ. O que organiza setor/tipo/orçamento/requisição é o **grupo**, não o CNPJ. Por isso o nível novo é uma **organização de compras** (na tela: **"empresa"**; no código: **org**), e a org aponta para seus CNPJs pagadores.

- Amarrar setor direto em `companies.id` (CNPJ) obrigaria a Viva a repetir cada setor 5×. Não serve.
- Decisões do dono (06/10/2026): **fornecedores por empresa** (independentes); **Feat = 1 CNPJ**; **orçamento depois** (no início tudo cai "sem orçamento"); rótulo de tela **"empresa"**.

## 3. Modelo de dados

### 3.1 Tabelas novas

```sql
-- A organização de compras ("empresa", na tela).
create table public.ctrl_orgs (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  slug       text not null unique,          -- usado no cookie/URL do seletor
  ativo      boolean not null default true,
  created_at timestamptz not null default now()
);

-- CNPJs pagadores de cada org (Viva: 5 linhas; Feat: 1).
create table public.ctrl_org_companies (
  org_id     uuid not null references public.ctrl_orgs(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  primary key (org_id, company_id),
  unique (company_id)   -- um CNPJ pertence a UMA org (evita ambiguidade do pagador)
);

-- Concessão de acesso por org (quais empresas o usuário alcança no Compras).
create table public.ctrl_user_orgs (
  user_id uuid not null references public.users(id) on delete cascade,
  org_id  uuid not null references public.ctrl_orgs(id) on delete cascade,
  primary key (user_id, org_id)
);
```

`ctrl_org_companies.unique(company_id)`: um CNPJ paga por uma org só. Sem isso, o picker de empresa pagadora do Contas a Pagar ficaria ambíguo e uma requisição da Feat poderia ser paga por um CNPJ da Viva.

### 3.2 `org_id` nas tabelas de domínio

| tabela | ganha `org_id`? | por quê |
|---|---|---|
| `ctrl_sectors` | **SIM** | setor é subnível da empresa (o eixo do pedido) |
| `ctrl_expense_types` | **SIM** | cada empresa tem seus tipos |
| `ctrl_requests` | **SIM** | a lista de Requisições/Aprovações filtra direto por empresa; e é o que trava o pagador na org |
| `ctrl_events` | **SIM** | "Eventos" é cadastro por empresa |
| `ctrl_suppliers` | **SIM** | decisão: fornecedores independentes por empresa |
| `ctrl_budget`, `ctrl_budget_items` | **NÃO** (derivado) | chaveados por `sector_id`, que já carrega a org — a RLS e as queries chegam à org via join no setor |
| `ctrl_supplier_expense_types` | NÃO | o fornecedor já tem org |
| `ctrl_company_omie_config` / `_sector_omie_departamento` / `_expense_type_omie_categoria` / `ctrl_supplier_omie` | NÃO | já são por `company_id` (CNPJ), que pertence a uma org via `ctrl_org_companies` |
| `ctrl_recurrence_groups`, `ctrl_notifications`, `ctrl_history`, `ctrl_approval_email_log` | NÃO | penduram na requisição/usuário; herdam a org pela requisição |

> **Decisão em aberto (menor):** denormalizar `org_id` em `ctrl_budget`/`_items` para RLS mais simples, ou derivar via `sector_id`. Recomendo **derivar** (menos colunas, uma fonte de verdade); o join setor→org na policy é barato. Trocável se o `EXPLAIN` pedir.

### 3.3 Rateio

O rateio (`ctrl_request_sectors`) é **sempre dentro de uma org** — não se rateia entre empresas. O `org_id` fica no pai (`ctrl_requests`); as parcelas referenciam setores da mesma org. Validar no `createRateioRequest` que todos os setores do rateio são da org ativa.

## 4. O que torna a adição SEGURA: aditivo + backfill (diff zero)

Mesma mecânica de `company_excluded_projects`:

1. Cria uma org **"Viva Company"** e semeia seus 5 CNPJs em `ctrl_org_companies`.
2. Concede a org Viva a **todos os usuários atuais** do Compras (`ctrl_user_orgs`).
3. Adiciona `org_id` **nullable** nas 5 tabelas → **backfill de TODAS as linhas para a org Viva** → `set not null` + FK + índice.
4. Toda query do módulo ganha `and org_id = <org ativa>`, e a **org ativa de todo usuário atual = Viva**.

**Prova de diff zero:** com só a org Viva existindo, todos granted em Viva e org ativa = Viva, cada query escopada devolve exatamente as linhas de hoje (todas são `org = viva`). A Feat nasce vazia. As permissões isolam sozinhas porque **id de setor é único por org**: o `user_sectors` de um usuário Viva aponta para setores Viva; os setores da Feat são ids novos que ele nunca alcança.

> **Semeadura dos 5 CNPJs:** resolver pelas empresas que **hoje têm `ctrl_company_omie_config`** (as que já pagam) — empiricamente o grupo Viva — e conferir contra os nomes dados. Confirmar a lista exata com um read read-only na hora de implementar (inclui checar "SPDX" × "SGX").

## 5. Contexto de "empresa ativa" (o seletor no menu)

Espelha o seletor de **segmento** do DRE (`active-context.ts` + cookie, resolvido no servidor no layout).

- Cookie novo `active_ctrl_org` (slug), com reader em `active-context.ts` (padrão do `readActiveSegmentSlug`), gravado via o route handler `/api/context`.
- `getCtrlUser()` (`src/lib/ctrl/auth.ts`) passa a resolver e expor:
  - `orgIds: string[]` — orgs concedidas (admin → todas as `ctrl_orgs.ativo`; demais → `ctrl_user_orgs`).
  - `orgId: string` — a org ativa (cookie validado contra `orgIds`; fallback = 1ª/única).
  - `orgCompanyIds: string[]` — CNPJs da org ativa (`ctrl_org_companies`), para o picker de pagador.
- Layout do Compras (`src/app/(ctrl)/ctrl/layout.tsx`) resolve a org ativa e passa ao shell um **CtrlOrgSwitcher** no cabeçalho do Compras.
- **Quem tem 1 org não vê o seletor** (entra já escopado — zero chance de errar). Só aparece para quem tem Feat **e** Viva (ex.: admin).
- **Guard:** org ativa fora de `orgIds` → cai para a 1ª concedida (nunca 403 por cookie velho).

### Por que isso evita "errar a empresa"
- A **Nova Requisição** lista no dropdown **só os setores da org ativa**; não dá para escolher um setor da Viva estando na Feat.
- O picker de **empresa pagadora** no Contas a Pagar oferece **só os CNPJs da org ativa**.
- A org ativa fica nomeada e visível no topo (etiqueta).

## 6. Onde a org entra (escopo)

- **`getRequests`** (`actions/requests.ts`): `.eq("org_id", ctx.orgId)` ANTES de toda a lógica de setor/perfil que já existe (que segue valendo DENTRO da org). O recorte por `ctx.sectorIds` continua — como são ids de setor, intersecta naturalmente com a org ativa.
- **`createRequest` / `createRateioRequest`:** grava `org_id = ctx.orgId`; valida que o(s) setor(es) escolhido(s) pertence(m) à org ativa (falha fechada).
- **`performBudgetVerification`:** inalterado — lê `ctrl_budget` por `sector_id`, que já é da org. Feat sem orçamento → tudo `nivel_3` ("não orçado"), como pedido.
- **Admin (setores, tipos, eventos, fornecedores, orçamento, mapeamento Omie):** listam/gravam escopado por `ctx.orgId`; inserts recebem `org_id`. O mapeamento Omie oferece só os CNPJs de `ctx.orgCompanyIds`.
- **Contas a Pagar:** picker de pagador = `ctx.orgCompanyIds`.
- **Relatórios:** `.eq("org_id", ctx.orgId)`.
- **Regras nominais (`routing.ts`):** já fixadas por id de setor (06/10/2026) → as regras da Viva nunca casam com setor da Feat. **Nenhuma mudança agora.** Se a Feat precisar de regra nominal própria, adiciona-se entrada com os ids dela depois.
- **Lembrete diário:** agrega por usuário entre as requisições pendentes; naturalmente multiempresa. O recorte por id de setor já isola. (Ver §9: decidir se o e-mail agrupa por empresa no corpo.)

## 7. RLS

Predicado novo (liberado a `authenticated`, como `has_ctrl_role()`):

```sql
create or replace function public.ctrl_has_org(p_org uuid)
returns boolean language sql security definer stable as $$
  select public.is_admin()
      or exists (
        select 1 from public.ctrl_user_orgs uo
        join public.users u on u.id = uo.user_id
        where uo.user_id = auth.uid() and uo.org_id = p_org and u.active
      );
$$;
-- predicado de policy → fica executável por authenticated (não reverter p/ service_role).
```

As policies de `ctrl_sectors`/`_expense_types`/`_requests`/`_events`/`_suppliers` ganham `and ctrl_has_org(org_id)` no `using`/`with check`, mantendo o `has_ctrl_role(...)` atual. Para `ctrl_budget`/`_items` (sem coluna), o predicado chega à org via subselect no `sector_id`. Backfill já concedeu Viva a todos → RLS dos usuários atuais fica idêntica.

> Atenção à nota do CLAUDE.md: função nova nasce executável por `anon`/`authenticated`. `ctrl_has_org` é **predicado de policy**, então FICA liberado a `authenticated` de propósito (igual a `has_ctrl_role`). As demais funções novas (se houver) seguem o `REVOKE ... / GRANT ... service_role`.

## 8. Ordem de implantação (etapas independentes e reversíveis)

1. **Migration A** — `ctrl_orgs` + `ctrl_org_companies` + `ctrl_user_orgs`; semeia org Viva + 5 CNPJs + concede Viva a todos os usuários com papel CTRL. *(Nada lê ainda → sem efeito.)*
2. **Migration B** — `org_id` nullable nas 5 tabelas → backfill = Viva → `not null` + FK + índice. *(Nada filtra ainda → sem efeito.)*
3. **Código** — contexto de org (cookie, `getCtrlUser`, layout, seletor escondido p/ 1 org), escopo por org em todas as queries, `org_id` nos inserts, picker de pagador restrito. Org ativa padrão = Viva → Viva idêntica.
4. **Migration C** — policies ganham `ctrl_has_org`. *(Viva já concedida → idêntico.)*
5. **Cadastro da Feat** — cria org Feat + 1 CNPJ (+ `ctrl_company_omie_config`), setores e tipos da Feat, concede a org Feat aos usuários da Feat. Orçamento depois.

Até a etapa 5 só existe a org Viva; a partir dela a Feat existe mas os usuários Viva não a veem. Cada etapa é deployável e reversível isoladamente.

## 9. Decisões (06/10/2026) e follow-ups

**Decidido pelo dono:**
- **Tela de Usuários — concessão COMPLETA na tela:** o admin marca quais empresas do Compras o usuário acessa e, dentro de cada uma, os setores, **agrupados por empresa** (não dá para vincular um setor da Feat a um usuário só-Viva por engano). `user_sectors` continua global e sem org — é a UI que agrupa; seguro porque id de setor é único por org.
- **Lembrete diário = UM E-MAIL POR EMPRESA.** Quem aprova em mais de uma empresa recebe um e-mail por empresa com pendência (cada um só daquela empresa), em vez de um e-mail agregando tudo. Na prática, `buildApprovalReminderPlan` passa a rodar por org e o envio itera as orgs do aprovador; a trava de duplicidade `ctrl_approval_email_log` ganha a org na chave (hoje `user_id`+`run_date`).
- **Usuários da Feat ficam para depois.** Agora só a base multiempresa (etapas A–D); o cadastro da Feat (CNPJ, setores, tipos, usuários) é a etapa E, quando o dono definir quem opera.

**Follow-ups (sem decisão pendente):**
- **Manual do Compras** (`src/lib/ctrl/manual/content.ts`): acrescentar o conceito de "empresa" e o seletor.
- **`user-exceptions.ts` / `routing.ts`:** sem mudança agora; registrar regra nominal da Feat lá quando existir.
- **Denormalizar `org_id` em `ctrl_budget`** (§3.2): decidir na implementação (recomendo derivar via setor).

## 10. Checklist de fiação (etapa 3)

- `supabase/migrations/` — A, B, C.
- `src/lib/context/active-context.ts` — `ACTIVE_CTRL_ORG_COOKIE` + reader.
- `src/app/api/context/route.ts` — aceitar a org ativa.
- `src/lib/ctrl/auth.ts` — `getCtrlUser` expõe `orgId` / `orgIds` / `orgCompanyIds`.
- `src/lib/auth/session.ts` — carregar as orgs concedidas no `modules.ctrl` (join em `ctrl_user_orgs`), como já faz com os papéis.
- `src/app/(ctrl)/ctrl/layout.tsx` — resolver org ativa; passar ao shell.
- `src/components/app/app-shell.tsx` (+ nav) — **CtrlOrgSwitcher** no cabeçalho do Compras.
- `src/lib/ctrl/actions/requests.ts` — filtro `org_id` no `getRequests`; `org_id` + validação de setor∈org no `createRequest`/`createRateioRequest`.
- `src/lib/ctrl/actions/{setores,expense-types,events,suppliers,omie-mapping,budget-editor,budget-items}.ts` — escopo por org; `org_id` nos inserts; picker de CNPJ por org.
- Páginas e formulários do admin do Compras + Contas a Pagar — seletores escopados.
- `src/lib/ctrl/manual/content.ts` — conceito de empresa.

## 11. O que já foi feito (pré-requisito, 06/10/2026)

As 4 regras nominais do `routing.ts` que casavam por NOME de setor foram fixadas por **id** (`APPROVER_SECTOR_RESTRICTIONS`, `DIRECTOR_HIGHLIGHT_SECTORS`, `REPORT_EXTRA_SECTORS`, `APPROVAL_COVERAGE`). Era o único ponto que vazaria entre empresas (um "Diretoria" da Feat casaria com a regra da Viva por nome). Inerte para a Viva; validado (lint, tsc, 833 testes, build). Isso remove o risco antes de qualquer segunda empresa existir.
```
