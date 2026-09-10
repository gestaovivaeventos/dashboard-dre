-- Endurecimento de segurança (auditoria 03/09/2026).
--
-- 1) ctrl_recurrence_groups nasceu sem RLS: qualquer chave anon lia e escrevia.
-- 2) Funções SECURITY DEFINER que mutam ou leem dados de qualquer empresa eram
--    executáveis por `authenticated` — um usuário logado (mesmo pendente) podia
--    mesclar setores, apagar linhas de orçamento, refazer agregados ou ler o
--    realizado de empresas que não acessa. O app só as chama pelo service role,
--    então a revogação não muda o comportamento em produção.
-- 3) `anon` não precisa executar nenhum helper SECURITY DEFINER.

-- 1) RLS em ctrl_recurrence_groups ---------------------------------------
ALTER TABLE public.ctrl_recurrence_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ctrl_recurrence_groups_read ON public.ctrl_recurrence_groups;
CREATE POLICY ctrl_recurrence_groups_read
  ON public.ctrl_recurrence_groups FOR SELECT TO authenticated
  USING (
    public.has_ctrl_role(ARRAY['admin','gerente','diretor','csc','contas_a_pagar'])
    OR created_by = auth.uid()
  );

DROP POLICY IF EXISTS ctrl_recurrence_groups_write ON public.ctrl_recurrence_groups;
CREATE POLICY ctrl_recurrence_groups_write
  ON public.ctrl_recurrence_groups FOR ALL TO authenticated
  USING (public.has_ctrl_role(ARRAY['admin','csc','contas_a_pagar']))
  WITH CHECK (public.has_ctrl_role(ARRAY['admin','csc','contas_a_pagar']));

-- 2) Funções privilegiadas: só service role -------------------------------
REVOKE EXECUTE ON FUNCTION public.ctrl_merge_sectors(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ctrl_merge_expense_types(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_dre_monthly_aggregates(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_cash_flow_monthly_aggregates(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.orcamento_media_realizado(uuid, integer, text[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.orcamento_planejamento_realizado_itens(uuid, integer, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.orcamento_status_por_empresa(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;

-- 3) Helpers de RLS: authenticated precisa, anon não ----------------------
--    `REVOKE ... FROM anon` sozinho não basta: anon herda EXECUTE de PUBLIC.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.is_admin()', 'public.is_hero_manager()', 'public.is_contracts_only_user()',
    'public.has_ctrl_role(text[])', 'public.get_ctrl_role()', 'public.has_case_access()',
    'public.has_viagens_access()', 'public.has_viagens_aprovar()', 'public.can_validate_bi_reports()',
    'public.user_has_company_access(uuid)', 'public.count_unmapped_categories()',
    'public.ctrl_find_supplier_by_doc(text)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;

-- Funções novas herdam EXECUTE de PUBLIC por padrão; fecha isso daqui pra frente.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- 4) Orçamento: era USING (true) para qualquer autenticado (inclusive pendente)
DO $$
DECLARE t text; p record;
BEGIN
  FOREACH t IN ARRAY ARRAY['budget_entries','budget_account_mappings','budget_uploads_raw'] LOOP
    FOR p IN SELECT polname FROM pg_policy WHERE polrelid = ('public.' || t)::regclass LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.polname, t);
    END LOOP;
    EXECUTE format($q$
      CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
        USING (public.is_admin() OR public.is_hero_manager() OR public.user_has_company_access(company_id))
    $q$, t || '_read', t);
    EXECUTE format($q$
      CREATE POLICY %I ON public.%I FOR ALL TO authenticated
        USING (public.is_admin()) WITH CHECK (public.is_admin())
    $q$, t || '_write_admin', t);
  END LOOP;
END $$;

-- 5) Histórico de pagamentos de contratos (CPF/CNPJ de fornecedores): era aberto
DROP POLICY IF EXISTS contract_paid_history_read ON public.contract_paid_history;
CREATE POLICY contract_paid_history_read ON public.contract_paid_history
  FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_hero_manager());

-- 6) Escrita em financial_entries / sync_log / omie_categories: remove a cláusula
--    legada `users.company_id` (não checava role nem active). Só admin/hero.
DROP POLICY IF EXISTS "Write financial_entries by permission" ON public.financial_entries;
CREATE POLICY "Write financial_entries by permission" ON public.financial_entries
  FOR ALL TO authenticated
  USING (public.is_admin() OR public.is_hero_manager())
  WITH CHECK (public.is_admin() OR public.is_hero_manager());

DROP POLICY IF EXISTS "Write sync_log by permission" ON public.sync_log;
CREATE POLICY "Write sync_log by permission" ON public.sync_log
  FOR ALL TO authenticated
  USING (public.is_admin() OR public.is_hero_manager())
  WITH CHECK (public.is_admin() OR public.is_hero_manager());

DROP POLICY IF EXISTS "Write omie_categories by permission" ON public.omie_categories;
CREATE POLICY "Write omie_categories by permission" ON public.omie_categories
  FOR ALL TO authenticated
  USING (public.is_admin() OR public.is_hero_manager())
  WITH CHECK (public.is_admin() OR public.is_hero_manager());

-- 7) Rateio de requisição: solicitante só mexe nas próprias
DROP POLICY IF EXISTS ctrl_request_sectors_write ON public.ctrl_request_sectors;
CREATE POLICY ctrl_request_sectors_write ON public.ctrl_request_sectors
  FOR ALL TO authenticated
  USING (
    public.has_ctrl_role(ARRAY['admin','gerente','diretor','csc','contas_a_pagar'])
    OR (public.has_ctrl_role(ARRAY['solicitante']) AND EXISTS (
      SELECT 1 FROM public.ctrl_requests r
      WHERE r.id = ctrl_request_sectors.request_id AND r.created_by = auth.uid()))
  )
  WITH CHECK (
    public.has_ctrl_role(ARRAY['admin','gerente','diretor','csc','contas_a_pagar'])
    OR (public.has_ctrl_role(ARRAY['solicitante']) AND EXISTS (
      SELECT 1 FROM public.ctrl_requests r
      WHERE r.id = ctrl_request_sectors.request_id AND r.created_by = auth.uid()))
  );

-- 8) Usuário desativado não pode continuar lendo dados da empresa pelo banco
CREATE OR REPLACE FUNCTION public.user_has_company_access(target_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select exists (
    select 1
    from public.user_company_access uca
    join public.users u on u.id = uca.user_id
    where uca.user_id = auth.uid()
      and uca.company_id = target_company_id
      and u.active = true
  );
$$;

-- 9) A linha de `users` é criada pelo trigger de signup; o INSERT livre permitia
--    reinserir a própria linha com role='admin' caso ela fosse apagada.
DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;

-- 10) Busca de fornecedor por documento: exige papel do Compras
CREATE OR REPLACE FUNCTION public.ctrl_find_supplier_by_doc(p_doc text)
RETURNS TABLE(id uuid, name text, status text, cnpj_cpf text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select s.id, s.name, s.status::text, s.cnpj_cpf
  from public.ctrl_suppliers s
  where public.has_ctrl_role(ARRAY['admin','solicitante','gerente','diretor','csc','contas_a_pagar','aprovacao_fornecedor'])
    and s.status <> 'rejeitado'
    and upper(regexp_replace(coalesce(p_doc, ''), '[^0-9A-Za-z]', '', 'g')) <> ''
    and upper(regexp_replace(coalesce(s.cnpj_cpf, ''), '[^0-9A-Za-z]', '', 'g'))
        = upper(regexp_replace(coalesce(p_doc, ''), '[^0-9A-Za-z]', '', 'g'));
$$;

-- 11) Auto-promoção a admin (setup de dev) nunca deve existir em produção
DROP FUNCTION IF EXISTS public.promote_first_admin_if_none();
