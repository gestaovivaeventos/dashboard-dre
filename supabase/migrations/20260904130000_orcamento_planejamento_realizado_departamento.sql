-- =============================================================================
-- Planejamento dos gestores — realizado do ano anterior POR DEPARTAMENTO.
--
-- A Etapa 1 semeia a base com os fornecedores do ano anterior da categoria. Com
-- o orçamento passando a ser por setor (Fase 1), essa lista precisa respeitar o
-- setor: o gestor do Comercial não deve receber, para validar, um fornecedor
-- que só o Produto usou.
--
-- O lançamento carrega `financial_entries.department_code` (o departamento da
-- Omie). A corrente até o setor do orçamento é:
--
--   department_code
--     -> ctrl_sector_omie_departamento.codigo_departamento  (por empresa)
--       -> ctrl_sectors.id
--         -> orcamento_setores.ctrl_sector_id               (ponte da Fase 1)
--
-- REGRA DO FORNECEDOR AMBÍGUO: se o mesmo fornecedor tem lançamentos em MAIS DE
-- UM departamento na categoria, ele não pertence a nenhum setor com segurança —
-- a função devolve departamento NULL e a aplicação o joga em "Não atribuído",
-- para alguém decidir. Fornecedor sem departamento no lançamento cai no mesmo
-- lugar, pelo mesmo motivo.
--
-- Só a assinatura de RETORNO muda (coluna `departamento`), então é DROP+CREATE.
-- =============================================================================

DROP FUNCTION IF EXISTS public.orcamento_planejamento_realizado_itens(uuid, integer, text, integer);

CREATE OR REPLACE FUNCTION public.orcamento_planejamento_realizado_itens(
  p_company_id uuid,
  p_base_year integer,
  p_category_code text,
  p_meses_fechados integer
)
RETURNS TABLE (
  fornecedor text,
  total numeric,
  total_fechado numeric,
  lancamentos bigint,
  departamento text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(NULLIF(btrim(supplier_customer), ''), 'Sem fornecedor') AS fornecedor,
    round(abs(sum(value))::numeric, 2) AS total,
    round(coalesce(abs(sum(value) FILTER (
      WHERE extract(month FROM payment_date) <= p_meses_fechados
    )), 0)::numeric, 2) AS total_fechado,
    count(*)::bigint AS lancamentos,
    -- Um único departamento distinto entre os lançamentos: o fornecedor é dele.
    -- Zero (sem departamento) ou vários: NULL = ambíguo, vai para "Não atribuído".
    CASE
      WHEN count(DISTINCT COALESCE(NULLIF(btrim(department_code), ''), '__sem__')) = 1
        THEN NULLIF(max(COALESCE(NULLIF(btrim(department_code), ''), '__sem__')), '__sem__')
      ELSE NULL
    END AS departamento
  FROM public.financial_entries
  WHERE company_id = p_company_id
    AND category_code = p_category_code
    AND type = 'despesa'
    AND payment_date >= make_date(p_base_year, 1, 1)
    AND payment_date <  make_date(p_base_year + 1, 1, 1)
  GROUP BY 1
  HAVING abs(sum(value)) > 0
  ORDER BY 2 DESC;
$$;

NOTIFY pgrst, 'reload schema';
