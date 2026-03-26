-- Allow authenticated users to create their own profile row in public.users

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'users'
      and policyname = 'Users can insert own profile'
  ) then
    create policy "Users can insert own profile"
    on public.users
    for insert
    to authenticated
    with check (id = auth.uid());
  end if;
end $$;
