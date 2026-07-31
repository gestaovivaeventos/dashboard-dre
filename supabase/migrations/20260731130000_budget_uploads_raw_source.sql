-- =============================================================================
-- Origem das linhas de orçamento (budget_uploads_raw.source).
--
-- Até aqui todas as linhas cruas vinham da planilha .xlsx, e cada novo upload
-- APAGAVA tudo daquele (empresa, ano) antes de reinserir. Com o módulo
-- Orçamento passando a alimentar o orçamento com a prévia de Despesas com
-- pessoal, as duas origens precisam coexistir: um upload de planilha não pode
-- levar embora as linhas do pessoal, nem o contrário.
--
--   source = 'planilha' → veio do upload .xlsx (padrão, retrocompatível)
--   source = 'pessoal'  → gerado pela prévia de Despesas com pessoal
--
-- Cada rotina passa a apagar SÓ a própria origem. Por isso a unicidade também
-- passa a considerar a origem: (company_id, year, month, label, source).
-- Na prática as duas nunca colidem, porque as linhas do pessoal usam rótulos
-- próprios ("Pessoal — Salários" etc.), mas a chave deixa isso garantido.
--
-- budget_entries não muda: reprocessBudgetEntriesForCompany soma as duas
-- origens ao reconstruir o orçamento do ano.
-- =============================================================================

ALTER TABLE public.budget_uploads_raw
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'planilha';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'budget_uploads_raw_source_check'
  ) THEN
    ALTER TABLE public.budget_uploads_raw
      ADD CONSTRAINT budget_uploads_raw_source_check
      CHECK (source IN ('planilha', 'pessoal'));
  END IF;
END $$;

-- Troca o unique (company_id, year, month, label) pelo que inclui a origem.
-- Drop por DESCOBERTA: o nome foi gerado pelo Postgres na criação da tabela.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.budget_uploads_raw'::regclass
      AND con.contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE public.budget_uploads_raw DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.budget_uploads_raw
  ADD CONSTRAINT budget_uploads_raw_company_year_month_label_source_key
  UNIQUE (company_id, year, month, label, source);

CREATE INDEX IF NOT EXISTS budget_uploads_raw_company_year_source_idx
  ON public.budget_uploads_raw (company_id, year, source);
