-- =============================================================================
-- Planejamento dos sócios — refinamentos (26/08/2026):
--  1) PERIODICIDADE por item (mensal | anual): pagamentos anuais são lançados no
--     mês da renovação, não diluídos em 12.
--  2) CURADORIA do administrador: quais fornecedores do ano anterior entram na
--     entrevista e com que NOME (renomear "DIVERSOS" → "Trello") — guarda na
--     própria linha da categoria (jsonb). A IA é guiada por essa seleção.
--  3) RPC do realizado por fornecedor agora respeita os MESES FECHADOS do
--     ano-base (mesma lógica da tela Média): o valor mensal sugerido deixa de ser
--     "total ÷ 12" (que subestima com o ano em curso) e passa a ser
--     "total dos meses fechados ÷ nº de meses fechados".
-- =============================================================================

-- 1) Periodicidade do item.
ALTER TABLE public.orcamento_planejamento_socios_itens
  ADD COLUMN IF NOT EXISTS periodicidade text NOT NULL DEFAULT 'mensal';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orcamento_planejamento_socios_itens_periodicidade_chk'
      AND conrelid = 'public.orcamento_planejamento_socios_itens'::regclass
  ) THEN
    ALTER TABLE public.orcamento_planejamento_socios_itens
      ADD CONSTRAINT orcamento_planejamento_socios_itens_periodicidade_chk
      CHECK (periodicidade IN ('mensal', 'anual'));
  END IF;
END $$;

-- 2) Curadoria (por fornecedor): [{ "fornecedor": "...", "nome": "...", "incluir": true }].
ALTER TABLE public.orcamento_planejamento_socios
  ADD COLUMN IF NOT EXISTS curadoria jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 3) RPC — realizado por fornecedor. Devolve DOIS totais:
--    - total         : ano-base INTEIRO (referência completa — o admin precisa
--                      ver TODA plataforma paga, inclusive as do mês em curso);
--    - total_fechado : só os meses FECHADOS (base da média/mês sugerida, mesma
--                      lógica da tela Média).
-- A completude vem do HAVING sobre o ano inteiro; o filtro de meses fechados só
-- entra no total_fechado. Assinatura tem 4 args (ganhou p_meses_fechados).
DROP FUNCTION IF EXISTS public.orcamento_planejamento_realizado_itens(uuid, integer, text);
DROP FUNCTION IF EXISTS public.orcamento_planejamento_realizado_itens(uuid, integer, text, integer);

CREATE OR REPLACE FUNCTION public.orcamento_planejamento_realizado_itens(
  p_company_id uuid,
  p_base_year integer,
  p_category_code text,
  p_meses_fechados integer
)
RETURNS TABLE (fornecedor text, total numeric, total_fechado numeric, lancamentos bigint)
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
    count(*)::bigint AS lancamentos
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
