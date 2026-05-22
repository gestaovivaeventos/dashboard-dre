-- =============================================================================
-- Renomeia a coluna `fee` (per-mes/empresa) para `vvr_meta` na tabela
-- company_fee_vvr, refletindo o significado real (meta mensal de VVR).
--
-- Adiciona em `companies` dois novos campos PER-EMPRESA (nao mensais):
--   - fee_disponivel: saldo de FEE atualmente disponivel.
--   - fee_a_receber: saldo de FEE a receber.
-- Esses campos sao independentes da tabela de metas mensais — apenas
-- armazenamento simples, sem efeito em calculos de DRE/Fluxo/KPIs.
-- =============================================================================

-- 1. Rename per-month column
ALTER TABLE public.company_fee_vvr
  RENAME COLUMN fee TO vvr_meta;

-- 2. Per-company balance fields
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS fee_disponivel numeric,
  ADD COLUMN IF NOT EXISTS fee_a_receber numeric;
