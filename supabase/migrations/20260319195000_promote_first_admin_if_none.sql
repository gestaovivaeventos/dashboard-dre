-- Permite promover o usuario autenticado a admin apenas quando ainda nao existe admin ativo.
-- Resolve setup local sem depender de SUPABASE_SERVICE_ROLE_KEY.

create or replace function public.promote_first_admin_if_none()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  has_active_admin boolean;
begin
  if auth.uid() is null then
    return false;
  end if;

  select exists (
    select 1
    from public.users u
    where u.role = 'admin'
      and u.active = true
  ) into has_active_admin;

  if has_active_admin then
    return false;
  end if;

  update public.users
  set role = 'admin',
      active = true
  where id = auth.uid();

  return true;
end;
$$;

grant execute on function public.promote_first_admin_if_none() to authenticated;
