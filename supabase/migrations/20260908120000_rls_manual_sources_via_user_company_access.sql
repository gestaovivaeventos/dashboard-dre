-- =============================================================================
-- RLS: fontes NAO-Omie da DRE liberadas pelo vinculo user_company_access
-- =============================================================================
--
-- SINTOMA: usuario do modelo novo (ex.: perfil `franqueado`, com as empresas
-- em `user_company_access` e `users.company_id` NULL) via os numeros da Omie
-- normalmente, mas NAO via os lancamentos manuais nem as receitas vindas de
-- planilha. Na pratica a DRE dele fechava com valores menores que a do admin,
-- sem nenhum aviso de erro.
--
-- CAUSA: a migration 20260522120000_rls_via_user_company_access.sql corrigiu o
-- vinculo legado (`users.company_id`) para o novo (`user_company_access`), mas
-- em uma LISTA FIXA de tabelas. Toda tabela empresa-escopada criada DEPOIS dela
-- copiou o template antigo — o comentario nos arquivos e literalmente
-- "RLS (mesmo padrao de category_mapping)", e a category_mapping so estava
-- certa por ter sido remendada por aquela lista. Sao quatro:
--
--   manual_account_values   (20260529130000)  <- receitas de planilha (Terrazzo,
--                                                Feat Producoes, Sirena)
--   manual_entries          (20260603120000)  <- lancamentos/ajustes manuais
--                                                (Village, Salvaterra)
--   project_mapping         (20260528130000)  <- roteamento por projeto (SGX)
--   company_feat_projetos   (20260624120000)  <- projetos da Feat Producoes
--
-- As duas primeiras sao as que produzem o sintoma visivel: as RPCs
-- `dashboard_dre_aggregate*` sao SECURITY INVOKER, entao a RLS do usuario e
-- aplicada DENTRO da funcao e o valor ja sai truncado do banco. As duas ultimas
-- nao tem sintoma hoje (o roteamento por projeto e aplicado no sync e chega
-- materializado em dre_monthly_aggregates), mas carregam o mesmo defeito.
--
-- CORRECAO: policy permissiva de SELECT lendo o vinculo correto — mesmo nome e
-- mesmo formato da criada em 20260522120000. Policies permissivas sao OR-ed,
-- entao isto apenas ADICIONA acesso: admin/hero e o caminho legado continuam
-- valendo e ninguem perde visibilidade. A escrita segue restrita ao admin
-- (policies "Write ... admin" inalteradas).
--
-- Idempotente: pode rodar mais de uma vez sem efeito.
-- =============================================================================

do $$
declare
  t text;
  tables text[] := array[
    'manual_account_values',
    'manual_entries',
    'project_mapping',
    'company_feat_projetos'
  ];
begin
  foreach t in array tables loop
    -- Nao assume que a tabela existe: as migrations deste projeto nem sempre
    -- foram aplicadas na ordem do nome do arquivo.
    if not exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      raise notice 'RLS user_company_access: tabela %.% ausente, ignorada', 'public', t;
      continue;
    end if;

    if exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = t
        and policyname = 'Read via user_company_access'
    ) then
      raise notice 'RLS user_company_access: policy ja existe em %, ignorada', t;
      continue;
    end if;

    execute format(
      'create policy "Read via user_company_access" on public.%I '
      || 'for select to authenticated using (public.user_has_company_access(company_id))',
      t
    );
    raise notice 'RLS user_company_access: policy criada em %', t;
  end loop;
end $$;
