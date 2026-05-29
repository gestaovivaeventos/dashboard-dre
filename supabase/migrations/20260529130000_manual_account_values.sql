-- =============================================================================
-- manual_account_values — Valores mensais inseridos fora do Omie
-- =============================================================================
-- Tabela para gravar valores mensais de contas DRE cuja fonte NAO eh o Omie.
-- Caso de uso inicial: Feat Producoes — receitas de eventos e impostos
-- (ISS, PIS, COFINS, IRPJ, CSLL) vem de uma planilha Google Sheets que o
-- gestor financeiro mantem com lancamentos por evento. O sync da planilha
-- agrega por (ano, mes) e faz upsert aqui.
--
-- A coluna `data_source` em dre_accounts (adicionada por este script) diz a
-- `dashboard_dre_aggregate` de onde ler o valor da conta. Default 'omie'
-- preserva o comportamento de TODAS as outras contas — so contas marcadas
-- explicitamente como 'sheets' (ou outra fonte manual no futuro) deixam de
-- somar financial_entries e passam a somar manual_account_values.
--
-- Mapeamento Feat Producoes:
--   1.1  Resultado dos eventos  → planilha
--   3.1  ISS                    → planilha
--   3.2  PIS                    → planilha
--   3.3  COFINS                 → planilha
--   9    IRPJ                   → planilha
--   10   Contribuicao Social    → planilha
-- =============================================================================

-- 1) Coluna data_source em dre_accounts
ALTER TABLE public.dre_accounts
  ADD COLUMN IF NOT EXISTS data_source text NOT NULL DEFAULT 'omie';

ALTER TABLE public.dre_accounts
  DROP CONSTRAINT IF EXISTS dre_accounts_data_source_check;

ALTER TABLE public.dre_accounts
  ADD CONSTRAINT dre_accounts_data_source_check
  CHECK (data_source IN ('omie', 'sheets', 'manual'));

CREATE INDEX IF NOT EXISTS dre_accounts_data_source_idx
  ON public.dre_accounts(data_source)
  WHERE data_source <> 'omie';

-- 2) Tabela manual_account_values
CREATE TABLE IF NOT EXISTS public.manual_account_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  dre_account_id uuid NOT NULL REFERENCES public.dre_accounts(id) ON DELETE CASCADE,
  ano integer NOT NULL CHECK (ano BETWEEN 2020 AND 2099),
  mes integer NOT NULL CHECK (mes BETWEEN 1 AND 12),
  valor numeric NOT NULL,
  source text NOT NULL DEFAULT 'sheets',
  source_metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manual_account_values_unique UNIQUE (company_id, dre_account_id, ano, mes)
);

CREATE INDEX IF NOT EXISTS manual_account_values_company_idx
  ON public.manual_account_values(company_id);

CREATE INDEX IF NOT EXISTS manual_account_values_account_period_idx
  ON public.manual_account_values(dre_account_id, ano, mes);

-- Touch updated_at on UPDATE
CREATE OR REPLACE FUNCTION public.manual_account_values_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS manual_account_values_updated_at ON public.manual_account_values;
CREATE TRIGGER manual_account_values_updated_at
  BEFORE UPDATE ON public.manual_account_values
  FOR EACH ROW EXECUTE FUNCTION public.manual_account_values_touch_updated_at();

-- 3) RLS (mesmo padrao de category_mapping)
ALTER TABLE public.manual_account_values ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read manual_account_values by permission" ON public.manual_account_values;
CREATE POLICY "Read manual_account_values by permission"
ON public.manual_account_values
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

DROP POLICY IF EXISTS "Write manual_account_values admin" ON public.manual_account_values;
CREATE POLICY "Write manual_account_values admin"
ON public.manual_account_values
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 4) Marca as 6 contas-alvo da Feat Producoes como `data_source = 'sheets'`.
--    Idempotente: roda sempre, sem efeito quando ja esta marcada.
DO $$
DECLARE
  v_company_id uuid;
BEGIN
  SELECT id INTO v_company_id
  FROM public.companies
  WHERE name = 'Feat Producoes'
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RAISE NOTICE 'Company Feat Producoes nao encontrada — pulando marcacao de contas manuais.';
    RETURN;
  END IF;

  UPDATE public.dre_accounts
  SET data_source = 'sheets'
  WHERE company_id = v_company_id
    AND code IN ('1.1', '3.1', '3.2', '3.3', '9', '10')
    AND data_source <> 'sheets';
END $$;
