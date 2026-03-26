-- Garantir escrita de companies para admin (RLS)

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'companies'
      and policyname = 'Admin insert companies'
  ) then
    alter policy "Admin insert companies"
    on public.companies
    to authenticated
    with check (public.is_admin());
  else
    create policy "Admin insert companies"
    on public.companies
    for insert
    to authenticated
    with check (public.is_admin());
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'companies'
      and policyname = 'Admin update companies'
  ) then
    alter policy "Admin update companies"
    on public.companies
    to authenticated
    using (public.is_admin())
    with check (public.is_admin());
  else
    create policy "Admin update companies"
    on public.companies
    for update
    to authenticated
    using (public.is_admin())
    with check (public.is_admin());
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'companies'
      and policyname = 'Admin delete companies'
  ) then
    alter policy "Admin delete companies"
    on public.companies
    to authenticated
    using (public.is_admin());
  else
    create policy "Admin delete companies"
    on public.companies
    for delete
    to authenticated
    using (public.is_admin());
  end if;
end $$;
