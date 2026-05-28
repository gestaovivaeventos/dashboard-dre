-- Auto-criação do perfil em public.users quando o usuário se cadastra via
-- Supabase Auth. Antes disso, a linha em public.users só nascia no primeiro
-- login (em session.ts) — então usuários que confirmavam o email mas nunca
-- entravam ficavam invisíveis para o admin na tela /usuarios.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, name, role, active)
  values (
    new.id,
    coalesce(new.email, new.id::text || '@placeholder.local'),
    nullif(new.raw_user_meta_data->>'name', ''),
    'gestor_unidade',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Backfill: usuários que já existem em auth.users mas não em public.users
-- (cadastraram-se antes do trigger e nunca chegaram a logar).
insert into public.users (id, email, name, role, active)
select
  au.id,
  coalesce(au.email, au.id::text || '@placeholder.local'),
  nullif(au.raw_user_meta_data->>'name', ''),
  'gestor_unidade',
  false
from auth.users au
left join public.users pu on pu.id = au.id
where pu.id is null;
