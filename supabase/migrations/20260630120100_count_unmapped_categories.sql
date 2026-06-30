-- =============================================================================
-- RPC: contagem de categorias Omie sem mapeamento DRE (alerta do Home)
-- =============================================================================
--
-- O Home (api/home/stats) tentava contar lançamentos sem mapeamento com:
--   from("financial_entries").select("omie_category_code").is("dre_account_id", null)
-- Mas `financial_entries` NÃO tem as colunas `omie_category_code` nem
-- `dre_account_id` (a coluna real é `category_code`; o vínculo com a conta DRE
-- vive em `category_mapping`). A query falhava em TODO load do Home —
-- inundando o log do Postgres com "column financial_entries.omie_category_code
-- does not exist" — e, como o supabase-js devolve {data:null} sem lançar, o
-- alerta de "sem mapeamento" silenciosamente reportava SEMPRE 0.
--
-- Esta função conta as categorias distintas presentes em financial_entries que
-- não têm mapeamento em category_mapping. SECURITY DEFINER para dar a contagem
-- GLOBAL (o Home é tela admin) independente da RLS do chamador — retorna só um
-- inteiro, sem expor linhas. Usa o índice (category_code) via index-only scan.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.count_unmapped_categories()
 RETURNS integer
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT count(*)::int
  FROM (
    SELECT DISTINCT fe.category_code
    FROM public.financial_entries fe
    WHERE fe.category_code IS NOT NULL
  ) c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.category_mapping cm
    WHERE cm.omie_category_code = c.category_code
  );
$function$;

GRANT EXECUTE ON FUNCTION public.count_unmapped_categories() TO authenticated;
