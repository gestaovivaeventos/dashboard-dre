# Guia de portabilidade — módulo **Chamados (Suporte)**

Escrito para: engenheiros de **outra plataforma Next.js + Supabase** que vão replicar o
módulo de Chamados do Control Hub, **usando o design system daquele projeto** para a UI.

O backend é praticamente copiável 1:1 (mesma stack). O trabalho real é: (1) rodar o
schema, (2) apontar 5 dependências para os equivalentes do projeto destino, (3) trocar
os componentes visuais pelo design system de lá. Este guia lista tudo isso.

> Fonte no Control Hub (para copiar os arquivos): `src/lib/support/*`,
> `src/app/(app)/chamados/page.tsx`, `src/components/app/chamados-client.tsx`,
> `supabase/migrations/2026091412…`, `…091512…`, `…091514…`.

---

## 1. O que o módulo faz

- Qualquer usuário logado **abre chamados** (categoria **melhoria** ou **bug**), com
  **título + descrição (obrigatórios) + anexos** (prints, PDFs…).
- **Lista** com **filtros** (busca por código/título/autor, status, categoria e — só admin —
  prioridade e responsável) e **código sequencial** por chamado (`#1`, `#2`…).
- **Detalhe** em modal: descrição, anexos (miniatura para imagem), **thread** de conversa.
- **Admin** (e só ele): vê todos os chamados, muda **status** e **prioridade**, define o
  **responsável** e responde. Usuário comum vê **só os próprios** e não vê prioridade.
- **Responsável (assignee)**: quando definido, passa a ser o **único destinatário** dos
  e-mails daquele chamado; sem responsável, os e-mails vão para **todos os admins**.
- **E-mails** (Resend, best-effort): novo chamado → admins; resposta do solicitante →
  responsável/admins; resposta da equipe → autor; mudança de status → autor; atribuição →
  responsável.

### Máquina de status (preserve exatamente)
`aberto → em_analise → aguardando_resposta → resolvido → fechado`
- Só o **admin** troca status (na mão), com uma exceção automática: quando o **solicitante
  responde** e o chamado estava `aguardando_resposta`, ele **volta para `em_analise`**.
- `resolvido` ainda aceita resposta (confirmar/reabrir). `fechado` **bloqueia a conversa**
  (a caixa de resposta some).
- `resolved_at`/`closed_at` são carimbados quando entra em `resolvido`/`fechado` e
  **zerados** ao sair.

---

## 2. Pré-requisitos no projeto destino (as 5 dependências a apontar)

O código referencia estes recursos do Control Hub. No destino, aponte para os equivalentes:

| # | Dependência (Control Hub) | O que faz | Como adaptar |
|---|---|---|---|
| 1 | `getCurrentSessionContext()` (`@/lib/auth/session`) | devolve `{ user, profile }`; `profile` tem `id`, `name`, `email` e `role`/`profile` | usar o helper de sessão de lá; precisa expor id/nome/email e como saber se é admin |
| 2 | `createClient()` server + `createAdminClientIfAvailable()` (`@/lib/supabase/*`) | client do usuário (RLS) e client service-role | usar os equivalentes; **o service-role é necessário** (URLs assinadas + leituras) |
| 3 | `createClient()` browser (`@/lib/supabase/client`) | upload do anexo pelo navegador | idem |
| 4 | `sendEmailViaResend({to,subject,html})` (`@/lib/email/resend`) | envio de e-mail | apontar para o sender de lá (Resend ou outro); remetente precisa de domínio verificado |
| 5 | Predicado SQL **`is_admin()`** | usado nas policies de RLS | **precisa existir no banco destino** (ver §3.1); senão, crie ou inline a checagem |

**Tabela `public.users`**: as tabelas referenciam `users(id)` e o código lê `users.name`,
`users.email`, `users.role` (`'admin'`) e `users.active`. Se o modelo de usuários de lá for
diferente (ex.: admin por outra coluna/roles), adapte **3 pontos**: `isSupportAdmin()`,
a query de `getSupportAdmins()` e a de `adminEmails()` (e o `is_admin()` do banco).

**Variáveis de ambiente**: `NEXT_PUBLIC_APP_URL` (URL absoluta do app — o link do e-mail
tem que ser absoluto), `RESEND_API_KEY` + remetente de domínio verificado,
`SUPABASE_SERVICE_ROLE_KEY`.

---

## 3. Banco de dados (rodar no Supabase destino, em ordem)

São 3 migrations. O SQL abaixo é o do Control Hub, **na íntegra**. Só depende de duas
coisas do destino: a tabela `public.users(id)` e o predicado `is_admin()`.

### 3.1 Predicado `is_admin()` (se ainda não existir no destino)

As policies usam `is_admin()`. Se o projeto destino não tiver, crie algo como:

```sql
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin' and u.active);
$$;
-- SECURITY DEFINER lido dentro de policies: manter executável por authenticated.
```
> Ajuste o critério de "admin" ao modelo de lá. Se preferir não criar a função, troque
> `is_admin()` nas policies pela subconsulta equivalente.

### 3.2 Migration 1 — tickets + anexos + bucket

```sql
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.users(id),
  title text not null,
  description text not null,
  category text not null default 'melhoria' check (category in ('melhoria', 'bug')),
  status text not null default 'aberto'
    check (status in ('aberto', 'em_analise', 'aguardando_resposta', 'resolvido', 'fechado')),
  priority text check (priority in ('baixa', 'media', 'alta')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  closed_at timestamptz
);
create index if not exists support_tickets_created_by_idx on public.support_tickets (created_by);
create index if not exists support_tickets_status_idx on public.support_tickets (status);
create index if not exists support_tickets_created_at_idx on public.support_tickets (created_at desc);

create table if not exists public.support_ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  message_id uuid, -- anexo numa mensagem da thread; nulo = anexo do próprio chamado
  path text not null,
  name text not null,
  mime text,
  size bigint,
  uploaded_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
);
create index if not exists support_ticket_attachments_ticket_idx on public.support_ticket_attachments (ticket_id);

alter table public.support_tickets enable row level security;
alter table public.support_ticket_attachments enable row level security;

-- Tickets: o dono vê/cria os seus; o admin vê e edita todos.
create policy support_tickets_select on public.support_tickets
  for select to authenticated using (created_by = auth.uid() or is_admin());
create policy support_tickets_insert on public.support_tickets
  for insert to authenticated with check (created_by = auth.uid());
create policy support_tickets_update on public.support_tickets
  for update to authenticated using (is_admin()) with check (is_admin());

-- Anexos: seguem a visibilidade do chamado; inserção só pelo próprio uploader.
create policy support_ticket_attachments_select on public.support_ticket_attachments
  for select to authenticated using (
    exists (select 1 from public.support_tickets t
      where t.id = ticket_id and (t.created_by = auth.uid() or is_admin())));
create policy support_ticket_attachments_insert on public.support_ticket_attachments
  for insert to authenticated with check (
    uploaded_by = auth.uid() and exists (select 1 from public.support_tickets t
      where t.id = ticket_id and (t.created_by = auth.uid() or is_admin())));

-- Bucket privado dos anexos. Path começa pelo id do usuário (as policies de storage
-- autorizam a escrita por isso); a leitura é por URL assinada no servidor (service role),
-- então o admin abre o anexo de qualquer chamado.
insert into storage.buckets (id, name, public)
values ('support-attachments', 'support-attachments', false)
on conflict (id) do nothing;

create policy support_attachments_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'support-attachments' and (auth.uid())::text = (storage.foldername(name))[1]);
create policy support_attachments_select on storage.objects for select to authenticated
  using (bucket_id = 'support-attachments' and (auth.uid())::text = (storage.foldername(name))[1]);
create policy support_attachments_delete on storage.objects for delete to authenticated
  using (bucket_id = 'support-attachments' and (auth.uid())::text = (storage.foldername(name))[1]);
```

### 3.3 Migration 2 — thread de mensagens

```sql
create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  user_id uuid not null references public.users(id),
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists support_ticket_messages_ticket_idx
  on public.support_ticket_messages (ticket_id, created_at);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'support_ticket_attachments_message_fk') then
    alter table public.support_ticket_attachments
      add constraint support_ticket_attachments_message_fk
      foreign key (message_id) references public.support_ticket_messages(id) on delete cascade;
  end if;
end $$;

alter table public.support_ticket_messages enable row level security;
create policy support_ticket_messages_select on public.support_ticket_messages
  for select to authenticated using (
    exists (select 1 from public.support_tickets t
      where t.id = ticket_id and (t.created_by = auth.uid() or is_admin())));
create policy support_ticket_messages_insert on public.support_ticket_messages
  for insert to authenticated with check (
    user_id = auth.uid() and exists (select 1 from public.support_tickets t
      where t.id = ticket_id and (t.created_by = auth.uid() or is_admin())));
```

### 3.4 Migration 3 — código sequencial + responsável

```sql
alter table public.support_tickets
  add column if not exists ticket_number bigint generated by default as identity;
create unique index if not exists support_tickets_number_uidx
  on public.support_tickets (ticket_number);

alter table public.support_tickets
  add column if not exists assignee_id uuid references public.users(id);
create index if not exists support_tickets_assignee_idx
  on public.support_tickets (assignee_id);
-- update de assignee_id já é coberto pela policy support_tickets_update (is_admin()).
```

---

## 4. Camada de dados (`src/lib/support/`) — copiar e ajustar imports

Quatro arquivos. Copie do Control Hub e ajuste só os imports das 5 dependências (§2).

### 4.1 `types.ts` — **copiar sem mudança** (só tipos/labels; sem dependência)
Define `TicketCategory`, `TicketStatus`, `TicketPriority`, `TicketAuthor`, `SupportAdmin`,
`TicketListItem` (inclui `ticket_number`, `assignee_id`, `assignee`), `TicketAttachment`,
`TicketDetail` (`+description`), `TicketMessage` (`fromRequester`) e `TICKET_STATUS_LABEL`.
Fica separado das actions **de propósito**: um arquivo `"use server"` só pode exportar
funções async — constantes/tipos precisam morar num módulo comum.

### 4.2 `attachment-upload.ts` — copiar; ajustar só o import do client browser
Client component. Sobe o arquivo para o bucket com `path = ${userId}/${Date.now()}-${nome}`
(a pasta pelo id do usuário é o que a policy de storage exige). Limite **10 MB** por arquivo
(`MAX_SUPPORT_ATTACHMENT_SIZE`), bucket `SUPPORT_ATTACHMENT_BUCKET = "support-attachments"`.
Ajuste: `import { createClient } from "@/lib/supabase/client"` para o equivalente.

### 4.3 `emails.ts` — copiar; ajustar sender + admins + URL
`"server-only"`. Cinco funções (`emailAdminsNewTicket`, `emailAuthorReply`,
`emailReplyToStaff`, `emailAssigneeAssigned`, `emailAuthorStatus`), todas **best-effort**
(`safeSend` engole erro — e-mail nunca derruba a ação). Ajuste:
- `import { sendEmailViaResend } from "@/lib/email/resend"` → sender de lá (assinatura
  `{ to: string | string[], subject, html }`, retornando algo com `.ok`).
- `FALLBACK_APP_URL` → URL de produção do app destino; `baseUrl()` lê `NEXT_PUBLIC_APP_URL`.
  **O link do e-mail tem que ser absoluto** (link relativo vira `http:///chamados`).
- `adminEmails(db)` → query dos admins ativos (hoje `users.role='admin' and active`).
- Regra a preservar em `emailReplyToStaff`: **responsável definido → só ele; senão → todos
  os admins**. O `shell()` é HTML inline (sem libs); adapte cor/branding se quiser.

### 4.4 `actions.ts` — copiar; ajustar sessão + clients + admin
`"use server"`. É a API do módulo. Contrato:

| Função | Quem | O que faz |
|---|---|---|
| `createTicket({title,description,category,attachments})` | qualquer logado | cria o chamado (`status:'aberto'`), grava anexos (falha de anexo não derruba), e-mail aos admins |
| `getTickets()` | qualquer logado | `{ isAdmin, tickets }`; admin vê todos, comum vê `created_by = eu`; ordena por `ticket_number desc` |
| `getTicket(id)` | dono ou admin | `{ isAdmin, ticket, attachments (URLs assinadas 10 min), messages }`; comum só o próprio |
| `addTicketMessage(id, body)` | dono ou admin | insere na thread; se solicitante responde e estava `aguardando_resposta` → `em_analise`; dispara e-mail (autor↔equipe) |
| `updateTicketStatus(id, status)` | **admin** | muda status + carimba `resolved_at`/`closed_at`; e-mail ao autor |
| `setTicketPriority(id, priority\|null)` | **admin** | define prioridade |
| `getSupportAdmins()` | **admin** | admins ativos (opções de responsável) |
| `setTicketAssignee(id, assigneeId\|null)` | **admin** | valida que é admin ativo; e-mail ao novo responsável |

Ajustes (todos no topo do arquivo):
- `getCurrentSessionContext` → helper de sessão de lá (precisa de `user`, `profile.id`,
  `profile.name`, `profile.email` e o critério de admin).
- `createAdminClientIfAvailable` / `createClient` → clients de lá. **Padrão do módulo**:
  checa a sessão na action e depois **lê/grava com o admin client** (`createAdminClientIfAvailable() ?? createClient()`);
  a RLS é a **segunda** linha de defesa. Mantenha esse padrão.
- `isSupportAdmin(profile)` → hoje `profile.profile==='admin' || profile.role==='admin'`.
  Ajuste ao modelo de lá.
- `TICKET_SELECT` usa os nomes das FKs (`support_tickets_created_by_fkey`,
  `support_tickets_assignee_id_fkey`, `support_ticket_messages_user_id_fkey`). Se o Postgres
  de lá nomear a FK diferente, ajuste os embeds (ou renomeie a constraint).
- `revalidatePath("/chamados")` → o caminho real da rota no app destino.

---

## 5. UI — blueprint + mapa para o design system de lá

Duas peças. **Não copie o Tailwind cru**: reconstrua a mesma estrutura com os componentes
do design system do outro sistema. O comportamento (estado, filtros, modais, thread) é o
que importa reproduzir.

### 5.1 `chamados/page.tsx` (server component)
Chama `getTickets()`; se admin, também `getSupportAdmins()`. Renderiza cabeçalho
("Chamados" + subtítulo) e `<ChamadosClient initialTickets isAdmin admins />`. Trata
`{error}` com um bloco de erro. → No destino, use o layout de página/cabeçalho **deles**.

### 5.2 `chamados-client.tsx` (client component) — estados e regras
Estado local: lista carregada (`initialTickets`), **filtros** (busca `q`, status, categoria,
e — só admin — prioridade e responsável, aplicados no cliente), modal **Novo chamado**
(título/categoria/descrição/anexos), modal **Detalhe** (`getTicket`), caixa de resposta.
Ações chamam as server actions e depois recarregam (`getTickets` / `getTicket`).

**Regras que a UI precisa manter:**
- **Prioridade, Autor e Responsável só aparecem para admin** (colunas da tabela, badge no
  detalhe e o painel de controles do admin). O solicitante **não vê prioridade**.
- **Bloco de controles do admin** no detalhe: selects de Status, Prioridade e Responsável,
  com a nota "Só o responsável recebe os e-mails deste chamado."
- **Legenda dos status** (tooltip no cabeçalho "Status" e no controle do admin) — texto em
  `STATUS_LEGEND`.
- **Thread**: mensagem da **equipe** vem destacada (cor + etiqueta "Equipe"); a do
  solicitante, neutra (`fromRequester`).
- **Fechado** → esconde a caixa de resposta (conversa bloqueada).
- **Anexo imagem** vira miniatura clicável; os demais, um "chip" com o nome.
- Validação: título e descrição obrigatórios; anexo > 10 MB é barrado antes do upload.

### 5.3 Mapa de componentes (troque pelos do design system de lá)

| No Control Hub (Tailwind cru) | Papel | Componente do DS destino |
|---|---|---|
| `<button class="bg-primary…">` | ação primária (Novo chamado, Abrir, Responder) | Button (primary) |
| `<button class="border…">` | secundária (Cancelar, Ver, Limpar, Adicionar anexos) | Button (outline/ghost) |
| `<div class="fixed inset-0…">` overlay | Novo chamado / Detalhe | Dialog/Modal |
| `<input class="INPUT_CLS">` | título, busca | Input |
| `<textarea>` | descrição, resposta | Textarea |
| `<select>` | categoria, status, prioridade, responsável, filtros | Select |
| input `type=file` escondido + botão | anexos | File upload do DS (ou manter o padrão input+trigger) |
| `CategoryBadge` / `StatusBadge` / `PriorityBadge` / "Equipe" | rótulos coloridos | Badge com variantes de cor |
| `<table>` da lista | lista de chamados | Table/DataTable do DS |
| `title=` nativo (legenda) | dica de status | Tooltip do DS |
| blocos `bg-destructive/10` | erros | Alert/Toast do DS |
| ícones `lucide-react` (Eye, Plus, Paperclip, X, Loader2, Info) | ícones | conjunto de ícones de lá |

Cores semânticas atuais (para mapear às do DS): categoria **bug** = vermelho, **melhoria** =
azul; status aberto=cinza, em_análise=âmbar, aguardando=violeta, resolvido=verde,
fechado=cinza-escuro; prioridade baixa=cinza, média=âmbar, alta=vermelho.

---

## 6. Fiação no app destino
1. **Rota**: colocar a página no route group logado (equivalente ao `(app)`), no caminho
   `/chamados` (ou outro — então ajuste `revalidatePath` e o link do e-mail).
2. **Menu**: item de navegação apontando para a rota, **visível a qualquer usuário logado**.
3. **Gate de acesso**: liberar a rota para todos os logados (o que cada um **vê** já é
   decidido nas actions/RLS; não precisa de papel especial para abrir chamado).

---

## 7. Checklist de adaptação (marque ao portar)
- [ ] `public.users(id, name, email, role, active)` existe (ou mapear as diferenças).
- [ ] `is_admin()` existe no banco (ou inline nas policies).
- [ ] Rodar as 3 migrations (§3) + criar o bucket `support-attachments`.
- [ ] Copiar `types.ts` (sem mudança) e `attachment-upload.ts` (só o import do client).
- [ ] `emails.ts`: sender + `adminEmails` + `FALLBACK_APP_URL`/`NEXT_PUBLIC_APP_URL`.
- [ ] `actions.ts`: sessão + clients + `isSupportAdmin` + nomes das FKs + `revalidatePath`.
- [ ] UI: reconstruir `page.tsx` e `chamados-client.tsx` com o **design system de lá**,
      preservando as regras da §5.2.
- [ ] Rota + menu + gate (§6).
- [ ] Env: `NEXT_PUBLIC_APP_URL`, `RESEND_API_KEY` (+ remetente verificado),
      `SUPABASE_SERVICE_ROLE_KEY`.
- [ ] Teste ponta a ponta: abrir (com anexo) → e-mail ao admin → admin muda status/define
      responsável → thread → e-mails indo só ao responsável.

---

## 8. Notas finais
- O `message_id` em `support_ticket_attachments` já está no schema, mas a UI **ainda não**
  anexa arquivo dentro de uma mensagem da thread (só no corpo do chamado). Está pronto para
  uma fase 2 sem migration.
- Tudo lê/grava com **service role** após checar a sessão; a RLS existe como segunda
  barreira. Se o projeto de lá preferir ler pelo client do usuário, a RLS já cobre o caso —
  mas as URLs assinadas de anexo do admin **exigem** o service role.
```
