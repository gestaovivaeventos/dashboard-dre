-- Desfaz 20260911120000_rls_fast_path_accessible_companies.sql: remove a policy
-- "00 Read by accessible companies" de toda tabela onde ela existir e a funcao.
-- As policies antigas (mais lentas) continuam no lugar, entao nenhum acesso muda.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_policies
    WHERE schemaname = 'public' AND policyname = '00 Read by accessible companies'
  LOOP
    EXECUTE format('DROP POLICY "00 Read by accessible companies" ON public.%I', r.tablename);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.accessible_company_ids();
