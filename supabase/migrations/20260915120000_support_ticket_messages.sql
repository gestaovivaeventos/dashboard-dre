-- Chamados (suporte) — BLOCO 2: thread de conversa. A mudança de status/prioridade
-- e os e-mails são de aplicação (não precisam de schema). Aqui só a tabela de
-- mensagens + a FK do message_id dos anexos (coluna criada no bloco 1).

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  user_id uuid not null references public.users(id),
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists support_ticket_messages_ticket_idx
  on public.support_ticket_messages (ticket_id, created_at);

-- FK do anexo por mensagem (message_id ficou reservado no bloco 1). Idempotente.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'support_ticket_attachments_message_fk'
  ) then
    alter table public.support_ticket_attachments
      add constraint support_ticket_attachments_message_fk
      foreign key (message_id) references public.support_ticket_messages(id) on delete cascade;
  end if;
end $$;

alter table public.support_ticket_messages enable row level security;

-- Mensagens seguem a visibilidade do chamado; inserção pelo próprio autor.
create policy support_ticket_messages_select on public.support_ticket_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.support_tickets t
      where t.id = ticket_id and (t.created_by = auth.uid() or is_admin())
    )
  );
create policy support_ticket_messages_insert on public.support_ticket_messages
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.support_tickets t
      where t.id = ticket_id and (t.created_by = auth.uid() or is_admin())
    )
  );
