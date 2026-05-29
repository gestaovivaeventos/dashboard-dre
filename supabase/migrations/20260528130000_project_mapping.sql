-- =============================================================================
-- project_mapping — Roteamento de DRE por projeto (Omie)
-- =============================================================================
-- Tabela generica escopada por empresa que mapeia projetos do Omie
-- (cCodProjeto) para contas DRE distintas conforme o entry seja receita
-- ou despesa.
--
-- Uso: empresas como SGX (segmento Real Estate) precisam roteiar lancamentos
-- por projeto em vez de (ou alem de) categoria. Quando um financial_entry
-- tem cCodProjeto preenchido E existe linha aqui para (company_id, projeto),
-- o sync redireciona o entry para `dre_account_revenue_id` (se type=receita)
-- ou `dre_account_expense_id` (se type=despesa) via category_mapping
-- sintetica — preservando o pipeline existente do dashboard_dre_aggregate
-- (que continua resolvendo via category_mapping).
--
-- Sem linhas aqui: comportamento inalterado para qualquer empresa. Vazia
-- por padrao — populada manualmente conforme novos projetos sao criados
-- no Omie da empresa.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.project_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  omie_project_code text NOT NULL,
  omie_project_name text,
  dre_account_revenue_id uuid REFERENCES public.dre_accounts(id) ON DELETE SET NULL,
  dre_account_expense_id uuid REFERENCES public.dre_accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  -- Pelo menos uma das contas de destino precisa estar definida — uma linha
  -- sem nenhuma das duas seria inerte.
  CONSTRAINT project_mapping_has_destination
    CHECK (dre_account_revenue_id IS NOT NULL OR dre_account_expense_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS project_mapping_company_code_idx
  ON public.project_mapping(company_id, omie_project_code);

CREATE INDEX IF NOT EXISTS project_mapping_company_idx
  ON public.project_mapping(company_id);

-- Touch updated_at on UPDATE
CREATE OR REPLACE FUNCTION public.project_mapping_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_mapping_updated_at ON public.project_mapping;
CREATE TRIGGER project_mapping_updated_at
  BEFORE UPDATE ON public.project_mapping
  FOR EACH ROW EXECUTE FUNCTION public.project_mapping_touch_updated_at();

-- ============================================================================
-- RLS (espelha as policies de category_mapping)
-- ============================================================================
ALTER TABLE public.project_mapping ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read project_mapping by permission" ON public.project_mapping;
CREATE POLICY "Read project_mapping by permission"
ON public.project_mapping
FOR SELECT
TO authenticated
USING (
  public.is_admin()
  OR public.is_hero_manager()
  OR company_id IN (
    SELECT u.company_id
    FROM public.users u
    WHERE u.id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Write project_mapping admin" ON public.project_mapping;
CREATE POLICY "Write project_mapping admin"
ON public.project_mapping
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());
