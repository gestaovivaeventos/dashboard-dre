-- =============================================================================
-- Módulo Orçamento — acesso por papel (fase A do ciclo construção → validação
-- → retorno; ver docs/superpowers/specs/2026-09-22-orcamento-ciclo-validacao-design.md).
--
-- O módulo nasceu ADMIN-ONLY: todas as policies de `orcamento_*` são
-- `is_admin()`. Com o ciclo, os CONSTRUTORES passaram a ser os gerentes (cada um
-- nos seus setores) e a diretoria valida — então a RLS precisa reconhecê-los.
--
-- Esta migration acrescenta os predicados e ABRE A LEITURA. A escrita continua
-- exigindo `is_admin()` na RLS, e o recorte de escrita por setor é feito nas
-- server actions (`autorizarEscrita` + `podeEscreverNoSetor` em
-- src/lib/orcamento/auth.ts), que gravam com service role. Isso é deliberado:
-- as tabelas do módulo não têm todas uma coluna de setor no mesmo formato, e uma
-- policy de escrita por setor daria uma falsa sensação de cobertura enquanto o
-- caminho real da gravação (service role) a ignora. A RLS aqui é a segunda
-- linha de defesa da LEITURA, que é o que o client do usuário faz.
--
-- Idempotente: pode rodar duas vezes.
-- =============================================================================

-- ─── 1) Predicados ───────────────────────────────────────────────────────────
-- Usados DENTRO de policies, por isso ficam liberados a `authenticated` — mesmo
-- enquadramento de `user_has_company_access()` (ver a auditoria de 03/09/2026).
-- Não confundir com as funções `SECURITY DEFINER` de dados, que têm de ser
-- revogadas de `anon`/`authenticated`.

-- Tem o módulo Orçamento? Concessão em user_module_roles OU admin, e sempre
-- limitado aos perfis que constroem/validam orçamento. Espelha
-- `resolveOrcamentoPapel` em src/lib/auth/orcamento.ts — se um lado mudar, o
-- outro precisa acompanhar.
CREATE OR REPLACE FUNCTION public.orcamento_has_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.active = true
      and (
        u.profile = 'admin'
        or (
          u.profile in ('diretor', 'gerente', 'gerente_setor')
          and exists (
            select 1 from public.user_module_roles r
            where r.user_id = u.id and r.module = 'orcamento'
          )
        )
      )
  );
$$;

-- Alcança o orçamento DESTA empresa? Admin vê todas; os demais dependem do
-- vínculo explícito em user_company_access, o mesmo escopo do Financeiro.
CREATE OR REPLACE FUNCTION public.orcamento_pode_ler_empresa(target_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select
    public.orcamento_has_access()
    and (
      public.is_admin()
      or public.user_has_company_access(target_company_id)
    );
$$;

REVOKE EXECUTE ON FUNCTION public.orcamento_has_access() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.orcamento_pode_ler_empresa(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.orcamento_has_access() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.orcamento_pode_ler_empresa(uuid) TO authenticated, service_role;

-- ─── 2) Leitura das tabelas do módulo ────────────────────────────────────────
-- Uma policy SELECT por tabela, ao lado da policy admin que já existe (elas são
-- OR: a admin continua valendo). A escrita segue só com is_admin() na RLS.
DO $$
DECLARE
  t text;
  -- Tabelas com company_id: a leitura é recortada pela empresa.
  com_empresa text[] := ARRAY[
    'orcamento_company_config',
    'orcamento_setores',
    'orcamento_categoria_metodo',
    'orcamento_categoria_setores',
    'orcamento_cargos',
    'orcamento_pessoal_colaboradores',
    'orcamento_media_categorias',
    'orcamento_valor_fixo_categorias',
    'orcamento_planejamento_socios',
    'orcamento_planejamento_socios_itens',
    'orcamento_encargos',
    'orcamento_beneficios_config'
  ];
BEGIN
  FOREACH t IN ARRAY com_empresa LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'company_id'
    ) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || ' orcamento read', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
        'USING (public.orcamento_pode_ler_empresa(company_id))',
        t || ' orcamento read', t
      );
    END IF;
  END LOOP;
END $$;

-- `orcamento_cargo_niveis` pende de `orcamento_cargos` (não tem company_id).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'orcamento_cargo_niveis'
  ) THEN
    DROP POLICY IF EXISTS "orcamento_cargo_niveis orcamento read"
      ON public.orcamento_cargo_niveis;
    CREATE POLICY "orcamento_cargo_niveis orcamento read"
      ON public.orcamento_cargo_niveis
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.orcamento_cargos c
          WHERE c.id = orcamento_cargo_niveis.cargo_id
            AND public.orcamento_pode_ler_empresa(c.company_id)
        )
      );
  END IF;
END $$;

-- Índices de correção são GLOBAIS (por ano, sem empresa): quem tem o módulo lê.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'orcamento_indices'
  ) THEN
    DROP POLICY IF EXISTS "orcamento_indices orcamento read" ON public.orcamento_indices;
    CREATE POLICY "orcamento_indices orcamento read"
      ON public.orcamento_indices
      FOR SELECT TO authenticated
      USING (public.orcamento_has_access());
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
