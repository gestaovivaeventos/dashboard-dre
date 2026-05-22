-- Aplicada em prod via MCP em 2026-05-22.
-- Registrada aqui pra versionamento e replay em ambientes locais/staging.
--
-- Contexto: o refactor pro modelo unificado de perfil (commit 35e77e6) moveu
-- o vinculo user -> empresa do campo legado `users.company_id` para a tabela
-- `user_company_access`. As policies RLS de varias tabelas empresa-escopadas
-- continuaram olhando o campo legado, deixando perfis novos (franqueado e
-- qualquer outro que so popule user_company_access) sem acesso aos dados.
--
-- Esta migration adiciona policies permissivas de SELECT que leem o vinculo
-- correto. Permissive policies sao OR-ed entre si: admin/hero/gestor_unidade
-- continuam vendo tudo pelas policies existentes; usuarios com vinculo em
-- user_company_access ganham acesso adicional.

create or replace function public.user_has_company_access(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_company_access uca
    where uca.user_id = auth.uid()
      and uca.company_id = target_company_id
  );
$$;

grant execute on function public.user_has_company_access(uuid) to authenticated;

-- 1) Companies: a tabela mae do vinculo.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'companies'
      and policyname = 'Users read companies via user_company_access'
  ) then
    create policy "Users read companies via user_company_access"
      on public.companies
      for select
      to authenticated
      using (
        exists (
          select 1 from public.user_company_access uca
          where uca.user_id = auth.uid() and uca.company_id = companies.id
        )
      );
  end if;
end $$;

-- 2) Demais tabelas empresa-escopadas. Cada uma tem company_id e ja tinha
--    uma policy que filtrava por users.company_id (legado).
do $$
declare
  t text;
  tables text[] := array[
    'financial_entries',
    'cash_flow_category_mappings',
    'cash_flow_opening_balances',
    'category_mapping',
    'company_departments',
    'company_fee_vvr',
    'company_partner_supplier_links',
    'company_partners',
    'omie_categories',
    'sync_log'
  ];
begin
  foreach t in array tables loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = t
        and policyname = 'Read via user_company_access'
    ) then
      execute format(
        'create policy "Read via user_company_access" on public.%I for select to authenticated using (public.user_has_company_access(company_id))',
        t
      );
    end if;
  end loop;
end $$;
