-- =============================================================================
-- RLS: funcoes de policy embrulhadas em (SELECT ...) => InitPlan, 1x por query
-- =============================================================================
--
-- Complemento (e correcao de premissa) de 20260911120000_rls_fast_path_
-- accessible_companies.sql. Aquela migration criou a policy "00 Read by
-- accessible companies" apostando que o Postgres avalia os bracos do OR das
-- policies em ordem de nome. O EXPLAIN real (Viva JF, como usuario Visao
-- Financeira) mostrou o contrario:
--
--   Filter: (is_admin() OR is_hero_manager() OR user_has_company_access(company_id)
--            OR (...routed...) OR is_admin() OR is_hero_manager()
--            OR (hashed SubPlan 7) OR (hashed SubPlan 8))
--
-- O planner poe as chamadas de funcao "simples" na frente e empurra os bracos
-- com SubPlan (o nosso hash, SubPlan 8) para o FIM. Resultado: para quem nao e
-- admin, cada linha ainda paga is_admin() + is_hero_manager() +
-- user_has_company_access(company_id) — tres funcoes SECURITY DEFINER, cada
-- uma executando a propria consulta em users/user_company_access — antes de
-- chegar ao hash. ~0,15-0,4ms por linha; 19 mil linhas estouram os 8s do
-- statement_timeout. Para o admin is_admin() e o primeiro braco e resolve.
--
-- CORRECAO (a recomendada pela Supabase para RLS): embrulhar cada funcao em
-- um subselect escalar, `(SELECT public.is_admin())`. Sem correlacao com a
-- linha, o planner o transforma em InitPlan: roda UMA vez por query e vira um
-- Param booleano; por linha sobra comparar o Param. E
-- `user_has_company_access(X)` vira `X IN (SELECT public.user_company_ids())`
-- — SubPlan hashed, tambem 1x por query. Com TODOS os bracos como
-- sublinks, nao ha mais braco "barato" para o planner antepor.
--
-- Como: le as policies do catalogo (pg_get_expr) das tabelas de public com RLS
-- e coluna company_id (as tabelas de dados, onde ha varredura grande),
-- reescreve USING/WITH CHECK por regex e aplica ALTER POLICY — nao depende do
-- texto dos arquivos de migration, que nem sempre bate com a producao.
-- Semantica identica: a mesma funcao, com o mesmo resultado, so que avaliada
-- uma vez. Roles e tipo (permissive/restrictive) da policy nao mudam.
--
-- Idempotente: desfaz o embrulho antes de reaplicar e so altera o que mudou.
-- =============================================================================

-- Conjunto de empresas com vinculo explicito do usuario corrente (mesma regra
-- de user_has_company_access apos o hardening: vinculo + usuario ativo).
CREATE OR REPLACE FUNCTION public.user_company_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT uca.company_id
  FROM public.user_company_access uca
  JOIN public.users u ON u.id = uca.user_id
  WHERE uca.user_id = auth.uid()
    AND u.active = true;
$$;

REVOKE EXECUTE ON FUNCTION public.user_company_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_company_ids() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION pg_temp.rls_wrap_expr(q text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  WITH zero AS (
    SELECT 'is_admin|is_hero_manager|has_case_access|is_contracts_only_user|can_validate_bi_reports|has_viagens_access|has_viagens_aprovar' AS fns
  ),
  -- 0) desfaz embrulhos de execucoes anteriores (forma deparseada:
  --    "( SELECT is_admin() AS is_admin)") para nao embrulhar duas vezes
  s0 AS (
    SELECT regexp_replace(
             regexp_replace(q,
               '\( SELECT (' || fns || ')\(\) AS \1\)', '\1()', 'g'),
             '\( SELECT has_ctrl_role\((ARRAY\[[^\]]*\])\) AS has_ctrl_role\)',
             'has_ctrl_role(\1)', 'g') AS q
    FROM zero
  ),
  -- 1) funcoes sem argumento -> (SELECT public.fn())
  s1 AS (
    SELECT regexp_replace(s0.q,
             '(^|[(\s])(' || fns || ')\(\)',
             '\1(SELECT public.\2())', 'g') AS q
    FROM s0, zero
  ),
  -- 2) has_ctrl_role(ARRAY[...]) -> (SELECT public.has_ctrl_role(ARRAY[...]))
  s2 AS (
    SELECT regexp_replace(s1.q,
             '(^|[(\s])has_ctrl_role\((ARRAY\[[^\]]*\])\)',
             '\1(SELECT public.has_ctrl_role(\2))', 'g') AS q
    FROM s1
  ),
  -- 3) user_has_company_access(col) -> (col IN (SELECT public.user_company_ids()))
  s3 AS (
    SELECT regexp_replace(s2.q,
             'user_has_company_access\(([A-Za-z_][A-Za-z0-9_.]*)\)',
             '(\1 IN (SELECT public.user_company_ids()))', 'g') AS q
    FROM s2
  )
  SELECT q FROM s3;
$$;

DO $$
DECLARE
  r record;
  new_qual text;
  new_check text;
  stmt text;
  altered int := 0;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl,
           p.polname,
           pg_get_expr(p.polqual, p.polrelid)      AS qual,
           pg_get_expr(p.polwithcheck, p.polrelid) AS wcheck
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relrowsecurity
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.oid
          AND a.attname = 'company_id'
          AND NOT a.attisdropped
      )
    ORDER BY c.relname, p.polname
  LOOP
    new_qual  := CASE WHEN r.qual   IS NULL THEN NULL ELSE pg_temp.rls_wrap_expr(r.qual)   END;
    new_check := CASE WHEN r.wcheck IS NULL THEN NULL ELSE pg_temp.rls_wrap_expr(r.wcheck) END;

    IF new_qual IS NOT DISTINCT FROM r.qual AND new_check IS NOT DISTINCT FROM r.wcheck THEN
      CONTINUE;
    END IF;

    stmt := format('ALTER POLICY %I ON public.%I', r.polname, r.tbl);
    IF new_qual IS NOT NULL THEN
      stmt := stmt || format(' USING (%s)', new_qual);
    END IF;
    IF new_check IS NOT NULL THEN
      stmt := stmt || format(' WITH CHECK (%s)', new_check);
    END IF;

    EXECUTE stmt;
    altered := altered + 1;
    RAISE NOTICE 'RLS initplan: % . % reescrita', r.tbl, r.polname;
  END LOOP;

  RAISE NOTICE 'RLS initplan: % policy(ies) reescrita(s)', altered;
END $$;

DROP FUNCTION pg_temp.rls_wrap_expr(text);
