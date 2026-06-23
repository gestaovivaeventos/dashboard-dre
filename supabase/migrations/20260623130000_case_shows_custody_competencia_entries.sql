-- ============================================================================
-- Detalhe por transação da Custódia (Análise Competência) — Case Shows
-- ============================================================================
-- Habilita o DRILLDOWN da seção "Custódia de Artistas - Análise Competência".
-- A tabela agregada case_shows_custody_competencia guarda só a SOMA por (empresa,
-- ano, mês de registro, categoria) — sem os lançamentos individuais. Esta tabela
-- guarda UMA LINHA por porção de categoria de cada movimento, pela DATA DE
-- REGISTRO (dDtRegistro) da Omie — exatamente a mesma extração (extractPortions)
-- que alimenta o agregado, então a soma das linhas reconcilia com a célula.
--
-- financial_entries NÃO serve para esse drilldown: é regime de caixa (data de
-- pagamento) e não reproduz o relatório por data de registro. Por isso uma tabela
-- dedicada, alimentada pela mesma ingestão (case-shows-custody-sync.ts), em
-- delete+insert por empresa/ano (espelho do estado atual da Omie).

CREATE TABLE IF NOT EXISTS public.case_shows_custody_competencia_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  period_year integer NOT NULL,
  period_month integer NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  registration_date date NOT NULL,
  category_code text NOT NULL,
  category_name text,
  description text,
  supplier_customer text,
  document_number text,
  omie_movement_id text,
  amount numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS case_shows_custody_competencia_entries_lookup_idx
  ON public.case_shows_custody_competencia_entries
  (company_id, registration_date, category_code);

CREATE INDEX IF NOT EXISTS case_shows_custody_competencia_entries_period_idx
  ON public.case_shows_custody_competencia_entries
  (company_id, period_year, period_month);

ALTER TABLE public.case_shows_custody_competencia_entries ENABLE ROW LEVEL SECURITY;

-- Leitura: mesmo critério do agregado (admin, gestor hero, ou acesso à empresa).
DROP POLICY IF EXISTS "Read case_shows_custody_competencia_entries by access"
  ON public.case_shows_custody_competencia_entries;
CREATE POLICY "Read case_shows_custody_competencia_entries by access"
ON public.case_shows_custody_competencia_entries
FOR SELECT
TO authenticated
USING (
  public.is_admin()
  OR public.is_hero_manager()
  OR public.user_has_company_access(company_id)
  OR company_id IN (
    SELECT u.company_id FROM public.users u WHERE u.id = auth.uid()
  )
);

-- Escrita: só admin via sessão. A ingestão roda com service role (ignora RLS).
DROP POLICY IF EXISTS "Write case_shows_custody_competencia_entries admin"
  ON public.case_shows_custody_competencia_entries;
CREATE POLICY "Write case_shows_custody_competencia_entries admin"
ON public.case_shows_custody_competencia_entries
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- ============================================================================
-- RPC de drilldown — lançamentos por DATA DE REGISTRO de uma linha (entradas/
-- saídas/comissões) da seção Competência, paginados.
-- ============================================================================
-- Filtra por empresa + conjunto de códigos de categoria Omie (os que compõem a
-- linha clicada) + intervalo de data de REGISTRO (coluna mensal ou acumulado) +
-- busca textual. O intervalo casa tanto a célula mensal quanto o total acumulado,
-- igual ao cash_flow_drilldown oficial.
CREATE OR REPLACE FUNCTION public.case_shows_custody_competencia_drilldown(
  p_company_id uuid,
  p_category_codes text[],
  p_date_from date,
  p_date_to date,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  entry_id uuid,
  registration_date date,
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
  WITH base AS (
    SELECT
      e.id AS entry_id,
      e.registration_date,
      e.description,
      e.supplier_customer,
      e.document_number,
      e.amount AS value,
      e.company_id,
      c.name AS company_name
    FROM public.case_shows_custody_competencia_entries e
    JOIN public.companies c ON c.id = e.company_id
    WHERE e.company_id = p_company_id
      AND e.registration_date BETWEEN p_date_from AND p_date_to
      AND e.category_code = ANY(p_category_codes)
      AND (
        p_search IS NULL
        OR p_search = ''
        OR e.description ILIKE '%' || p_search || '%'
        OR COALESCE(e.supplier_customer, '') ILIKE '%' || p_search || '%'
        OR COALESCE(e.document_number, '') ILIKE '%' || p_search || '%'
      )
  ),
  counted AS (
    SELECT
      base.*,
      count(*) OVER() AS total_count
    FROM base
    ORDER BY base.registration_date DESC, base.entry_id DESC
    LIMIT p_limit
    OFFSET p_offset
  )
  SELECT
    counted.entry_id,
    counted.registration_date,
    counted.description,
    counted.supplier_customer,
    counted.document_number,
    counted.value,
    counted.company_id,
    counted.company_name,
    counted.total_count
  FROM counted;
$$;

GRANT EXECUTE ON FUNCTION public.case_shows_custody_competencia_drilldown(uuid, text[], date, date, text, integer, integer) TO authenticated;
