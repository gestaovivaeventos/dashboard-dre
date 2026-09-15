-- Módulo de Chamados (suporte interno): qualquer usuário abre chamados de
-- melhoria/bug; admins veem todos e gerenciam. BLOCO 1 — chamados + anexos
-- (a thread de conversa, mudança de status/prioridade e e-mails vêm no bloco 2;
-- a coluna message_id em anexos já fica reservada para lá).

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
  message_id uuid, -- reservado p/ o bloco 2 (anexo numa mensagem da thread); nulo = anexo do chamado
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
  for select to authenticated
  using (created_by = auth.uid() or is_admin());
create policy support_tickets_insert on public.support_tickets
  for insert to authenticated
  with check (created_by = auth.uid());
create policy support_tickets_update on public.support_tickets
  for update to authenticated
  using (is_admin()) with check (is_admin());

-- Anexos: seguem a visibilidade do chamado; inserção só pelo próprio uploader.
create policy support_ticket_attachments_select on public.support_ticket_attachments
  for select to authenticated
  using (
    exists (
      select 1 from public.support_tickets t
      where t.id = ticket_id and (t.created_by = auth.uid() or is_admin())
    )
  );
create policy support_ticket_attachments_insert on public.support_ticket_attachments
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from public.support_tickets t
      where t.id = ticket_id and (t.created_by = auth.uid() or is_admin())
    )
  );

-- Bucket privado dos anexos (prints e arquivos). O path começa pelo id do
-- usuário — é o que as policies de storage usam para autorizar a escrita; a
-- leitura é por URL assinada gerada no servidor (service role), então o admin
-- abre o anexo de qualquer chamado. Mesmo padrão do bucket case-attachments.
insert into storage.buckets (id, name, public)
values ('support-attachments', 'support-attachments', false)
on conflict (id) do nothing;

create policy support_attachments_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'support-attachments' and (auth.uid())::text = (storage.foldername(name))[1]);
create policy support_attachments_select on storage.objects for select to authenticated
  using (bucket_id = 'support-attachments' and (auth.uid())::text = (storage.foldername(name))[1]);
create policy support_attachments_delete on storage.objects for delete to authenticated
  using (bucket_id = 'support-attachments' and (auth.uid())::text = (storage.foldername(name))[1]);
