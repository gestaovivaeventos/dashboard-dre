-- Log de acesso (compliance): toda sessão aberta e encerrada no Supabase Auth.
--
-- O login acontece no navegador, direto no Supabase: o servidor do app não fica
-- sabendo. auth.sessions tem ip/user_agent, mas a linha é apagada no logout (e
-- quando a sessão expira). Por isso um gatilho copia cada entrada/saída para
-- uma tabela permanente, que o app só lê.
--
-- Invariante: o login NUNCA pode falhar por causa do log. A função do gatilho
-- engole qualquer erro (bloco exception cobrindo o corpo inteiro).
--
-- Idempotente: pode rodar mais de uma vez sem duplicar nada.

-- 1) Tabela ------------------------------------------------------------------
-- user_id sem FK: o log precisa sobreviver à exclusão do usuário (por isso
-- também a cópia do e-mail no momento do evento).
create table if not exists public.auth_access_log (
  id bigint generated always as identity primary key,
  user_id uuid,
  email text,
  event text not null check (event in ('login', 'logout')),
  session_id uuid,
  ip inet,
  user_agent text,
  aal text,
  source text not null default 'trigger' check (source in ('trigger', 'backfill')),
  occurred_at timestamptz not null default now()
);

create index if not exists auth_access_log_occurred_at_idx
  on public.auth_access_log (occurred_at desc);
create index if not exists auth_access_log_user_occurred_at_idx
  on public.auth_access_log (user_id, occurred_at desc);

-- 2) RLS: só admin lê; ninguém grava/edita/apaga pelo app (log imutável) -------
alter table public.auth_access_log enable row level security;

drop policy if exists auth_access_log_read_admin on public.auth_access_log;
create policy auth_access_log_read_admin on public.auth_access_log
  for select to authenticated
  using (public.is_admin());

-- service_role incluído: nem o admin client do app consegue alterar o log.
-- Só o gatilho (security definer, dono postgres) grava.
revoke insert, update, delete, truncate on public.auth_access_log
  from anon, authenticated, service_role;

-- 3) Função do gatilho ---------------------------------------------------------
-- security definer (dona postgres): quem insere em auth.sessions é o role do
-- GoTrue, que não tem permissão na tabela do app.
create or replace function public.log_auth_session_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if tg_op = 'INSERT' then
      insert into public.auth_access_log
        (user_id, email, event, session_id, ip, user_agent, aal, source, occurred_at)
      values (
        new.user_id,
        (select u.email from auth.users u where u.id = new.user_id),
        'login',
        new.id,
        new.ip,
        new.user_agent,
        new.aal::text,
        'trigger',
        coalesce(new.created_at, now())
      );
    elsif tg_op = 'DELETE' then
      insert into public.auth_access_log
        (user_id, email, event, session_id, ip, user_agent, aal, source, occurred_at)
      values (
        old.user_id,
        -- Na exclusão do usuário as sessões caem em cascata depois dele: o
        -- e-mail vem então do último registro do próprio log.
        coalesce(
          (select u.email from auth.users u where u.id = old.user_id),
          (select l.email from public.auth_access_log l
            where l.user_id = old.user_id and l.email is not null
            order by l.id desc limit 1)
        ),
        'logout',
        old.id,
        old.ip,
        old.user_agent,
        old.aal::text,
        'trigger',
        now()
      );
    end if;
  exception when others then
    raise warning 'log_auth_session_event failed: % (%)', sqlerrm, sqlstate;
  end;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

alter function public.log_auth_session_event() owner to postgres;

-- Só o gatilho usa a função (o privilégio EXECUTE não é checado no disparo).
revoke execute on function public.log_auth_session_event() from public, anon, authenticated;

drop trigger if exists on_auth_session_created_log on auth.sessions;
create trigger on_auth_session_created_log
  after insert on auth.sessions
  for each row execute function public.log_auth_session_event();

drop trigger if exists on_auth_session_deleted_log on auth.sessions;
create trigger on_auth_session_deleted_log
  after delete on auth.sessions
  for each row execute function public.log_auth_session_event();

-- 4) Leituras agregadas (tela Acessos e coluna "Último acesso") -----------------
-- security invoker: continuam sujeitas à RLS. O app chama com o admin client,
-- depois de checar o perfil admin.
create or replace view public.auth_access_last_login
with (security_invoker = true) as
select user_id, max(occurred_at) as last_login_at
from public.auth_access_log
where event = 'login' and user_id is not null
group by user_id;

revoke all on public.auth_access_last_login from anon, authenticated;
grant select on public.auth_access_last_login to service_role;

-- Cartões da tela: sem tipo escolhido, contam as entradas (login).
create or replace function public.auth_access_log_summary(
  p_from timestamptz,
  p_to timestamptz,
  p_user_id uuid default null,
  p_event text default null
)
returns table (total bigint, unique_users bigint, last_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*)::bigint,
    count(distinct l.user_id)::bigint,
    max(l.occurred_at)
  from public.auth_access_log l
  where l.occurred_at >= p_from
    and l.occurred_at < p_to
    and l.event = coalesce(p_event, 'login')
    and (p_user_id is null or l.user_id = p_user_id);
$$;

revoke execute on function public.auth_access_log_summary(timestamptz, timestamptz, uuid, text)
  from public, anon, authenticated;
grant execute on function public.auth_access_log_summary(timestamptz, timestamptz, uuid, text)
  to service_role;

-- 5) Backfill: sessões abertas hoje, para o log não começar do zero -------------
insert into public.auth_access_log
  (user_id, email, event, session_id, ip, user_agent, aal, source, occurred_at)
select
  s.user_id,
  u.email,
  'login',
  s.id,
  s.ip,
  s.user_agent,
  s.aal::text,
  'backfill',
  coalesce(s.created_at, now())
from auth.sessions s
left join auth.users u on u.id = s.user_id
where not exists (
  select 1 from public.auth_access_log l
  where l.session_id = s.id and l.event = 'login'
);
