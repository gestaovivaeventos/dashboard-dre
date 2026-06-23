-- ============================================================================
-- Tabela gerencial: case_shows_custody_competencia
-- ============================================================================
-- Fonte de dados da seção "Custódia de Artistas - Análise Competência" (EXCLUSIVA
-- Case Shows). Diferente de financial_entries (regime de caixa, por data de
-- pagamento), esta tabela é alimentada por uma ingestão DEDICADA que chama
-- ListarMovimentos da Omie filtrando por DATA DE REGISTRO (dDtRegDe/dDtRegAte),
-- replicando exatamente o relatório que a antiga planilha do Google Sheets
-- montava. NÃO substitui o sync oficial — é aditiva e isolada.
--
-- Granularidade: um valor agregado por (empresa, ano, mês de registro, categoria
-- Omie). A ingestão faz delete+insert por empresa/ano a cada execução, então a
-- tabela é sempre um espelho do estado atual da Omie por data de registro.

CREATE TABLE IF NOT EXISTS public.case_shows_custody_competencia (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  period_year integer NOT NULL,
  period_month integer NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  category_code text NOT NULL,
  category_name text,
  amount numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, period_year, period_month, category_code)
);

CREATE INDEX IF NOT EXISTS case_shows_custody_competencia_company_period_idx
  ON public.case_shows_custody_competencia (company_id, period_year, period_month);

ALTER TABLE public.case_shows_custody_competencia ENABLE ROW LEVEL SECURITY;

-- Leitura: mesmo critério dos demais agregados de fluxo (admin, gestor hero,
-- ou quem tem acesso à empresa). A seção é renderizada com a sessão do usuário.
DROP POLICY IF EXISTS "Read case_shows_custody_competencia by access" ON public.case_shows_custody_competencia;
CREATE POLICY "Read case_shows_custody_competencia by access"
ON public.case_shows_custody_competencia
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

-- Escrita: só admin via sessão. A ingestão roda com service role (admin client),
-- que ignora RLS — esta policy cobre eventuais escritas autenticadas.
DROP POLICY IF EXISTS "Write case_shows_custody_competencia admin" ON public.case_shows_custody_competencia;
CREATE POLICY "Write case_shows_custody_competencia admin"
ON public.case_shows_custody_competencia
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- A RPC cash_flow_aggregate_by_registration (tentativa anterior de derivar a
-- data de registro do raw_json) fica OBSOLETA: o raw_json não contém a verdadeira
-- data de registro da Omie. A seção passa a ler desta tabela. Removida para não
-- confundir.
DROP FUNCTION IF EXISTS public.cash_flow_aggregate_by_registration(uuid[], date, date, text[]);
DROP FUNCTION IF EXISTS public.cash_flow_aggregate_by_registration(uuid[], date, date);
