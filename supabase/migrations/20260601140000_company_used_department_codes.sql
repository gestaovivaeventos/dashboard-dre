-- =============================================================================
-- RPC: codigos de departamento EFETIVAMENTE usados por uma empresa
-- =============================================================================
-- Contexto:
--   O catalogo de departamentos (company_departments) e populado por
--   syncCompanyDepartments a partir de ListarDepartamentos. Para nao poluir a
--   tela com o no raiz sintetico da Omie ("Sua Empresa"), o sync descarta
--   "agregadores" (nos com filhos na arvore). Porem um departamento pode TER
--   sub-departamentos E AINDA receber lancamentos diretamente (ex.: CUBO na
--   Feat Producoes) — nesse caso ele precisa aparecer como opcao de filtro.
--
--   Este RPC devolve os codigos de departamento que aparecem em
--   financial_entries para a empresa, para que o sync resgate agregadores que
--   estao em uso (recebem lancamentos) e os mantenha selecionaveis.
--
-- Por que um RPC (e nao um select direto):
--   PostgREST limita respostas a db-max-rows (1000) e nao expoe DISTINCT — um
--   select cru de department_code poderia truncar e esconder justamente o
--   codigo procurado. Aqui o DISTINCT acontece no banco, usando o indice
--   financial_entries_company_dept_idx (company_id, department_code), e retorna
--   apenas os codigos unicos (poucas dezenas, no maximo).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.company_used_department_codes(
  p_company_id uuid
)
RETURNS TABLE (department_code text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT fe.department_code
  FROM public.financial_entries fe
  WHERE fe.company_id = p_company_id
    AND fe.department_code IS NOT NULL
    AND btrim(fe.department_code) <> '';
$$;

GRANT EXECUTE ON FUNCTION public.company_used_department_codes(uuid) TO authenticated;
