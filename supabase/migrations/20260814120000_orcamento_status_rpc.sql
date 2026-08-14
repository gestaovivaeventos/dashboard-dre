-- =============================================================================
-- Módulo Orçamento — status de andamento por empresa × ano (Fase 3).
--
-- O painel de entrada e o hub de cada empresa mostram "em que pé está" o
-- orçamento. Computar isso empresa a empresa (várias contagens) explodiria em
-- dezenas de requisições no painel; então agregamos TUDO num RPC só, uma linha
-- por empresa ativa, com as contagens que alimentam os selos de cada módulo:
--
--   colaboradores    → quadro de Despesas com pessoal
--   media_total      → categorias marcadas com método 'media'
--   media_com_valor  → dessas, quantas já têm média salva (snapshot)
--   metodo_count     → categorias com método definido (proxy da Configuração)
--
-- SECURITY DEFINER porque some por cima de tabelas com RLS admin-only; o acesso
-- é protegido na server action (admin-only). É só leitura de contagem.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.orcamento_status_por_empresa(p_year integer)
RETURNS TABLE (
  company_id uuid,
  colaboradores integer,
  media_total integer,
  media_com_valor integer,
  metodo_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id AS company_id,
    COALESCE(p.cnt, 0)::int AS colaboradores,
    COALESCE(mt.cnt, 0)::int AS media_total,
    COALESCE(mv.cnt, 0)::int AS media_com_valor,
    COALESCE(cm.cnt, 0)::int AS metodo_count
  FROM public.companies c
  LEFT JOIN (
    SELECT company_id, count(*) AS cnt
    FROM public.orcamento_pessoal_colaboradores
    WHERE year = p_year
    GROUP BY company_id
  ) p ON p.company_id = c.id
  LEFT JOIN (
    SELECT company_id, count(*) AS cnt
    FROM public.orcamento_categoria_metodo
    WHERE year = p_year AND metodo = 'media'
    GROUP BY company_id
  ) mt ON mt.company_id = c.id
  LEFT JOIN (
    SELECT company_id, count(*) AS cnt
    FROM public.orcamento_media_categorias
    WHERE year = p_year AND media_valor IS NOT NULL
    GROUP BY company_id
  ) mv ON mv.company_id = c.id
  LEFT JOIN (
    SELECT company_id, count(*) AS cnt
    FROM public.orcamento_categoria_metodo
    WHERE year = p_year AND metodo IS NOT NULL
    GROUP BY company_id
  ) cm ON cm.company_id = c.id
  WHERE c.active = true;
$$;

GRANT EXECUTE ON FUNCTION public.orcamento_status_por_empresa(integer) TO authenticated;
