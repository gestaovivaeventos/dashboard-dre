-- Corrige dashboard_dre_drilldown para casar a conta DRE pelo `code` em vez
-- do `id` estrito. Quando uma empresa tem plano DRE customizado (forkado),
-- o dashboard exibe o id CLONADO da conta. Mas:
--   • category_mapping com company_id IS NULL continua apontando para o
--     id GLOBAL.
--   • category_mapping com company_id = X (após o fork) foi reapontado
--     para o id CLONADO.
-- Resultado: a função antiga filtrava por igualdade estrita de id e
-- perdia ou as entradas mapeadas globalmente, ou as mapeadas pela
-- empresa — dependendo de qual id era passado.
--
-- A correção: para cada lançamento, resolver a conta via mapping (mesma
-- ordem de prioridade que dashboard_dre_aggregate — company-specific se
-- existir, senão global) e comparar o CODE da conta resolvida com o code
-- da conta requisitada. Como `code` é idêntico entre o plano global e o
-- plano clonado de qualquer empresa, isso casa em ambos os cenários.
--
-- Mantém compatível com o comportamento anterior: empresas sem plano
-- customizado (usando o plano global) continuam funcionando porque o
-- code da conta global é o mesmo. Não altera nenhum cálculo já validado.

CREATE OR REPLACE FUNCTION public.dashboard_dre_drilldown(
  p_dre_account_id uuid,
  p_company_ids uuid[],
  p_date_from date,
  p_date_to date,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  financial_entry_id uuid,
  payment_date date,
  description text,
  supplier_customer text,
  document_number text,
  value numeric,
  company_id uuid,
  company_name text,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH target AS (
    SELECT code
    FROM public.dre_accounts
    WHERE id = p_dre_account_id
  ),
  base AS (
    SELECT
      fe.id AS financial_entry_id,
      fe.payment_date,
      fe.description,
      fe.supplier_customer,
      fe.document_number,
      fe.value,
      fe.company_id,
      c.name AS company_name
    FROM public.financial_entries fe
    JOIN public.companies c ON c.id = fe.company_id
    CROSS JOIN LATERAL (
      SELECT cm.dre_account_id
      FROM public.category_mapping cm
      WHERE cm.omie_category_code = fe.category_code
        AND (cm.company_id = fe.company_id OR cm.company_id IS NULL)
      ORDER BY cm.company_id NULLS LAST
      LIMIT 1
    ) mapping
    JOIN public.dre_accounts resolved ON resolved.id = mapping.dre_account_id
    WHERE fe.payment_date BETWEEN p_date_from AND p_date_to
      AND fe.company_id = ANY(p_company_ids)
      AND resolved.code = (SELECT code FROM target)
      AND (
        p_search IS NULL
        OR p_search = ''
        OR fe.description ILIKE '%' || p_search || '%'
        OR COALESCE(fe.supplier_customer, '') ILIKE '%' || p_search || '%'
        OR COALESCE(fe.document_number, '') ILIKE '%' || p_search || '%'
      )
      AND (
        c.has_department_apportionment IS NOT TRUE
        OR EXISTS (
          SELECT 1
          FROM public.company_departments cd
          WHERE cd.company_id = fe.company_id
            AND cd.included = true
            AND cd.omie_code = COALESCE(fe.department_code, '__none__')
        )
      )
  ),
  counted AS (
    SELECT
      base.*,
      count(*) OVER() AS total_count
    FROM base
    ORDER BY base.payment_date DESC, base.financial_entry_id DESC
    LIMIT p_limit
    OFFSET p_offset
  )
  SELECT
    counted.financial_entry_id,
    counted.payment_date,
    counted.description,
    counted.supplier_customer,
    counted.document_number,
    counted.value,
    counted.company_id,
    counted.company_name,
    counted.total_count
  FROM counted;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_dre_drilldown(uuid, uuid[], date, date, text, integer, integer) TO authenticated;
