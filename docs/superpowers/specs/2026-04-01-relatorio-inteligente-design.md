# Relatório Inteligente — Design Spec

## Resumo

Nova área "Inteligência" no Controll Hub (admin only) que usa IA para gerar relatórios financeiros, comparativos entre empresas e projeções. Inclui envio por email via Gmail (Nodemailer), cron mensal automático e histórico completo.

## Decisões de Design

| Decisão | Escolha |
|---------|---------|
| Escopo | Relatório sob demanda + alertas mensais automáticos + KPIs + previsto x realizado |
| Destinatários | Emails pré-cadastrados por empresa + escolha livre na hora |
| Estilo do relatório | Dashboard Narrativo (cards KPIs, destaques, tabela prev x real, recomendações) |
| Provedor IA | Agnóstico via AI SDK da Vercel (menor custo disponível) |
| Email | Nodemailer + Gmail App Password (substitui Resend em todo o sistema) |
| Alertas automáticos | Cron mensal no dia 5 (gera + envia relatório completo) |
| Features extras | Comparativo entre empresas, projeções, histórico de relatórios |

## Arquitetura

```
DRE Engine (dre.ts) → dados financeiros JSON
                          ↓
              AI SDK → generateText (system prompt por tipo)
                          ↓
              render-email.ts → HTML (estilo Dashboard Narrativo)
                          ↓
              gmail.ts (Nodemailer) → email para destinatários
                          ↓
              Supabase → salva em ai_reports (histórico)
```

A IA recebe um JSON estruturado com dados da DRE, KPIs, orçamento e histórico. Ela não acessa o banco diretamente — isso é mais seguro, mais barato (menos tokens) e mais previsível.

## Página: `/admin/inteligencia`

Admin only. Quatro tabs:

### Tab 1: Relatório (sob demanda)

- Seleciona empresa(s) e período (mês/trimestre/ano)
- Seleciona destinatários: contatos pré-cadastrados da empresa + campo para emails avulsos
- Botão "Gerar Relatório" → IA processa → preview na tela
- Botão "Enviar por Email" → envia e salva no histórico
- Conteúdo do relatório:
  - Header com empresa e período
  - Cards de KPIs (receita, EBITDA, margem) com variação vs mês anterior
  - Resumo narrativo do período
  - Grid destaques positivos / pontos de atenção
  - Tabela previsto x realizado (top contas com maior desvio)
  - Recomendações de ação

### Tab 2: Comparativo entre Empresas

- Seleciona segmento (ou todas) e período
- IA gera ranking de unidades: quem performou melhor, quem precisa atenção
- Detecta padrões entre empresas do mesmo segmento
- Pode enviar por email ou só visualizar

### Tab 3: Projeções

- Seleciona empresa e horizonte (próximos 3, 6 ou 12 meses)
- IA analisa tendência histórica e projeta: receita, margem, EBITDA
- Três cenários: otimista / realista / pessimista
- Visual com dados de tendência

### Tab 4: Histórico

- Lista de todos os relatórios gerados (data, tipo, empresa, destinatários)
- Busca por empresa/período
- Botão de visualizar e reenviar
- Status de entrega (enviado/erro)

## Cron Mensal (dia 5)

- Endpoint: `POST /api/cron/monthly-report`
- Autenticado via `CRON_SECRET` (mesmo padrão do sync)
- Para cada empresa ativa com contatos cadastrados:
  1. Busca dados DRE do mês anterior
  2. Busca orçamento (previsto) do mesmo período
  3. Busca KPIs calculados
  4. Monta JSON de contexto → envia pra IA
  5. Renderiza HTML do relatório
  6. Envia para contatos da empresa
  7. Salva no histórico (`ai_reports`)
- Se houver erro em alguma empresa, continua com as demais e alerta o admin

## Modelo de Dados

### Tabela: `ai_reports`

```sql
create table public.ai_reports (
  id uuid primary key default gen_random_uuid(),
  type text not null,              -- 'relatorio', 'comparativo', 'projecao'
  company_ids uuid[] not null,     -- empresas incluídas
  period_from date not null,
  period_to date not null,
  content_html text not null,      -- relatório renderizado (HTML do email)
  content_json jsonb not null,     -- dados estruturados (pra re-renderizar/auditar)
  recipients text[] not null,      -- emails dos destinatários
  sent_at timestamptz,             -- null se só preview/draft
  status text not null default 'draft', -- 'draft', 'sent', 'error'
  error_message text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.ai_reports enable row level security;

create policy "Admins can manage reports"
  on public.ai_reports for all to authenticated
  using (public.is_admin());
```

### Tabela: `company_contacts`

```sql
create table public.company_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  email text not null,
  role_label text,                 -- 'Sócio', 'Diretor', 'Controller', etc.
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index company_contacts_company_idx on public.company_contacts(company_id);

alter table public.company_contacts enable row level security;

create policy "Admins can manage contacts"
  on public.company_contacts for all to authenticated
  using (public.is_admin());
```

## APIs

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/intelligence/generate` | Gera relatório (tipo, empresas, período) → retorna preview HTML + salva draft |
| POST | `/api/intelligence/send` | Envia email (report_id + emails opcionais) |
| GET | `/api/intelligence/history` | Lista histórico com filtros (tipo, empresa, período) |
| POST | `/api/intelligence/resend` | Reenvia relatório existente para mesmos ou novos destinatários |
| GET | `/api/intelligence/contacts?companyId=X` | Lista contatos de uma empresa |
| POST | `/api/intelligence/contacts` | Cria/atualiza contato |
| DELETE | `/api/intelligence/contacts/[id]` | Remove contato |
| POST | `/api/cron/monthly-report` | Cron mensal — gera e envia pra todas as empresas |

## Estrutura de Arquivos

```
src/
├── app/
│   ├── (app)/
│   │   └── admin/
│   │       └── inteligencia/
│   │           └── page.tsx              -- página com 4 tabs
│   └── api/
│       ├── intelligence/
│       │   ├── generate/route.ts
│       │   ├── send/route.ts
│       │   ├── history/route.ts
│       │   ├── resend/route.ts
│       │   └── contacts/
│       │       ├── route.ts              -- GET + POST
│       │       └── [id]/route.ts         -- DELETE
│       └── cron/
│           └── monthly-report/route.ts
├── components/app/
│   ├── intelligence-view.tsx             -- componente principal com tabs
│   ├── report-preview.tsx                -- preview do relatório gerado
│   └── contacts-manager.tsx              -- CRUD de contatos por empresa
└── lib/
    ├── email/
    │   └── gmail.ts                      -- Nodemailer + Gmail transport
    └── intelligence/
        ├── generate-report.ts            -- monta dados + chama IA → relatório
        ├── generate-comparison.ts        -- ranking + análise entre empresas
        ├── generate-projection.ts        -- tendência histórica + projeção
        ├── render-email.ts               -- output da IA → HTML Dashboard Narrativo
        └── prompts.ts                    -- system prompts por tipo
```

## Migração de Email

- Criar `src/lib/email/gmail.ts` com Nodemailer + Gmail SMTP transport
- Atualizar `src/lib/notifications/resend.ts` → substituir chamadas Resend por `gmail.sendEmail()`
- Remover dependência `resend` do package.json
- Novas env vars: `GMAIL_USER`, `GMAIL_APP_PASSWORD`
- Remover `RESEND_API_KEY` do .env

## Navegação

- Adicionar item "Inteligência" em `navigation.ts` com ícone `Brain` (lucide-react)
- Roles: `["admin"]` only
- Rota: `/admin/inteligencia`

## Dependências Novas

```
npm install ai @ai-sdk/openai nodemailer
npm install -D @types/nodemailer
```

- `ai` — AI SDK core da Vercel
- `@ai-sdk/openai` — provedor inicial (trocar depois se necessário, basta mudar o import)
- `nodemailer` — envio de email via SMTP/Gmail

## Configuração do Gmail

1. Ativar verificação em 2 etapas na conta Google
2. Gerar "Senha de App" em https://myaccount.google.com/apppasswords
3. Adicionar ao .env:
   ```
   GMAIL_USER=seuemail@gmail.com
   GMAIL_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
   ```

## Vercel Cron

Adicionar ao `vercel.json`:
```json
{
  "crons": [
    { "path": "/api/cron/sync-all", "schedule": "0 6 * * *" },
    { "path": "/api/cron/monthly-report", "schedule": "0 9 5 * *" }
  ]
}
```

O relatório mensal roda no dia 5 às 09:00 BRT (12:00 UTC), dando tempo pro fechamento do mês.

## Custo Estimado

- IA: ~R$ 0,10-0,30 por relatório (tokens input + output)
- Gmail: grátis (limite 500 emails/dia, mais que suficiente)
- Para 20 empresas ativas no cron mensal: ~R$ 2-6/mês em tokens de IA
