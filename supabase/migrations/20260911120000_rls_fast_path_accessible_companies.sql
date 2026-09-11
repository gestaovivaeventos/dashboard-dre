-- =============================================================================
-- RLS: caminho rapido por conjunto de empresas acessiveis (1 avaliacao/query)
-- =============================================================================
--
-- SINTOMA: a tela Fluxo de Caixa abria para o admin e caia em "Algo deu errado
-- ao carregar esta tela" para o perfil Visao Financeira (`franqueado`). Medido
-- como um usuario desse perfil: `cash_flow_partner_breakdown` sobre o historico
-- completo e `cash_flow_partner_first_omie_month` estouram o statement_timeout
-- (8s, erro 57014); pelo service role a mesma RPC responde em ~90ms. Um SELECT
-- direto das ~19 mil linhas de financial_entries de UMA empresa tambem estoura;
-- um mes (295 linhas) leva ~480ms — ou seja, ~1,5ms POR LINHA so de RLS.
--
-- CAUSA: as policies permissivas sao OR-adas em ordem de nome e avaliadas linha
-- a linha. Para o admin o primeiro braco (`is_admin()`) ja da true. Para o
-- franqueado cada linha percorre `is_admin()`, `is_hero_manager()`, o subselect
-- legado de users.company_id, o EXISTS de roteamento por departamento e so
-- entao `user_has_company_access(company_id)` — quatro/cinco funcoes SQL
-- SECURITY DEFINER por linha (nao inlinaveis, cada uma com sua propria
-- consulta). Em 19 mil linhas isso passa dos 8s. E o mesmo custo que obrigava o
-- drilldown a ser lido mes a mes.
--
-- CORRECAO: uma funcao `accessible_company_ids()` que devolve o CONJUNTO de
-- empresas que o usuario corrente pode ler (todas para admin/hero; as de
-- user_company_access, com usuario ativo, para os demais) e uma policy
-- permissiva `company_id IN (SELECT public.accessible_company_ids())`. O
-- subselect nao depende da linha, entao o planner o executa UMA vez por query
-- (SubPlan hashed) e cada linha vira uma consulta em hash — para admin e
-- franqueado igualmente.
--
-- A policy se chama "00 Read by accessible companies" DE PROPOSITO: o Postgres
-- monta o OR das policies permissivas em ordem de nome (indice
-- pg_policy_polrelid_polname_index) e o executor avalia da esquerda para a
-- direita com curto-circuito. Comecando com "00" ela vem antes de qualquer
-- "Admin..."/"Read..." e resolve a linha antes que os bracos caros rodem.
--
-- Escopo: toda tabela de public com RLS, coluna company_id e alguma policy
-- que ja usa user_has_company_access(company_id) — exatamente as tabelas onde
-- o caminho lento existe (financial_entries, agregados mensais, mapeamentos,
-- socios, documentos, custodia, orcamento, fontes manuais...). So ADICIONA
-- acesso ja concedido pelos bracos existentes (admin/hero ja liam tudo;
-- user_company_access ja liberava via user_has_company_access, que tambem
-- exige usuario ativo). O caminho legado por users.company_id fica de fora, de
-- proposito: continua valendo pelas policies antigas, sem ampliar leitura em
-- tabelas onde ele nao existia (ex.: orcamento).
--
-- Idempotente: pode rodar mais de uma vez.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.accessible_company_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- admin / gestor_hero ativos: todas as empresas
  SELECT c.id
  FROM public.companies c
  WHERE public.is_admin() OR public.is_hero_manager()
  UNION
  -- demais: vinculo explicito, usuario ativo (mesma regra de
  -- user_has_company_access apos o hardening de 03/09/2026)
  SELECT uca.company_id
  FROM public.user_company_access uca
  JOIN public.users u ON u.id = uca.user_id
  WHERE uca.user_id = auth.uid()
    AND u.active = true;
$$;

REVOKE EXECUTE ON FUNCTION public.accessible_company_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accessible_company_ids() TO authenticated, service_role;

DO $$
DECLARE
  r record;
  created int := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT c.relname AS tbl
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relrowsecurity
      AND pg_get_expr(p.polqual, p.polrelid) LIKE '%user_has_company_access(company_id)%'
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.oid
          AND a.attname = 'company_id'
          AND a.atttypid = 'uuid'::regtype
          AND NOT a.attisdropped
      )
    ORDER BY 1
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = r.tbl
        AND policyname = '00 Read by accessible companies'
    ) THEN
      RAISE NOTICE 'RLS fast path: policy ja existe em %, ignorada', r.tbl;
      CONTINUE;
    END IF;

    EXECUTE format(
      'CREATE POLICY "00 Read by accessible companies" ON public.%I '
      || 'FOR SELECT TO authenticated '
      || 'USING (company_id IN (SELECT public.accessible_company_ids()))',
      r.tbl
    );
    created := created + 1;
    RAISE NOTICE 'RLS fast path: policy criada em %', r.tbl;
  END LOOP;

  RAISE NOTICE 'RLS fast path: % policy(ies) criada(s)', created;
END $$;

-- ---------------------------------------------------------------------------
-- POST-SCRIPTUM (11/09/2026, depois de aplicada): a premissa da ordem por nome
-- NAO se confirmou. O planner antepoe as chamadas de funcao simples e joga os
-- bracos com SubPlan (esta policy inclusive) para o fim do OR, entao o custo
-- por linha continuou. A correcao efetiva esta em
-- 20260911130000_rls_initplan_wrap_policy_functions.sql (funcoes embrulhadas
-- em (SELECT ...) => InitPlan). Esta policy segue valida e barata (hash), so
-- nao resolve sozinha.
-- ---------------------------------------------------------------------------
