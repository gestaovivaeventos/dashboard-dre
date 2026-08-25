-- =============================================================================
-- Módulo Orçamento — método PLANEJAMENTO DOS SÓCIOS (entrevista conduzida por IA).
--
-- Categorias marcadas com o método 'planejamento_socios' na tela "Método de
-- orçamento por categoria" são orçadas por uma ENTREVISTA guiada por IA (Gemini).
--
-- Uma categoria (ex.: "Softwares, Sistemas e Servidores") reúne VÁRIOS ITENS —
-- cada plataforma/serviço contratado. A IA lista as plataformas já pagas no ano
-- anterior (a partir de financial_entries) e pergunta, uma a uma, se serão
-- mantidas; pergunta também sobre novas contratações. O orçado da categoria é a
-- SOMA dos itens, e cai na MESMA linha da DRE da categoria na Prévia.
--
-- Duas tabelas:
--   1. orcamento_planejamento_socios        — nível CATEGORIA: a conversa com a
--      IA (transcript, auditoria), a justificativa/premissas e o status.
--   2. orcamento_planejamento_socios_itens   — nível ITEM: cada plataforma, com
--      um VALOR MENSAL e o MÊS DE INÍCIO (serviço novo em julho conta jul..dez).
--      Congela o número do ano (valor, não fórmula viva) — princípio do módulo.
-- =============================================================================

-- ─── Categoria: conversa + justificativa + status ───────────────────────────
CREATE TABLE IF NOT EXISTS public.orcamento_planejamento_socios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  category_code text NOT NULL,
  category_name text,
  -- Premissas/justificativa do número (texto livre).
  justificativa text,
  -- Transcript do chat com a IA: [{ "role": "user"|"assistant", "content": "…" }].
  conversa jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'rascunho',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (company_id, year, category_code)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orcamento_planejamento_socios_status_chk'
      AND conrelid = 'public.orcamento_planejamento_socios'::regclass
  ) THEN
    ALTER TABLE public.orcamento_planejamento_socios
      ADD CONSTRAINT orcamento_planejamento_socios_status_chk
      CHECK (status IN ('rascunho', 'concluido'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS orcamento_planejamento_socios_company_year_idx
  ON public.orcamento_planejamento_socios (company_id, year);

DROP TRIGGER IF EXISTS orcamento_planejamento_socios_touch_updated_at_trg ON public.orcamento_planejamento_socios;
CREATE TRIGGER orcamento_planejamento_socios_touch_updated_at_trg
BEFORE UPDATE ON public.orcamento_planejamento_socios
FOR EACH ROW EXECUTE FUNCTION public.orcamento_touch_updated_at();

-- ─── Itens: uma plataforma/serviço por linha ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.orcamento_planejamento_socios_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  category_code text NOT NULL,
  descricao text NOT NULL,
  -- Valor mensal em reais.
  valor_mensal numeric NOT NULL DEFAULT 0 CHECK (valor_mensal >= 0),
  -- Mês (1..12) a partir do qual o valor passa a valer.
  mes_inicio integer NOT NULL DEFAULT 1 CHECK (mes_inicio BETWEEN 1 AND 12),
  -- 'mantido' (já pago no ano anterior) | 'novo' (nova contratação).
  origem text NOT NULL DEFAULT 'novo',
  -- Fornecedor de referência do ano anterior (quando o item veio de lá).
  fornecedor text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orcamento_planejamento_socios_itens_origem_chk'
      AND conrelid = 'public.orcamento_planejamento_socios_itens'::regclass
  ) THEN
    ALTER TABLE public.orcamento_planejamento_socios_itens
      ADD CONSTRAINT orcamento_planejamento_socios_itens_origem_chk
      CHECK (origem IN ('mantido', 'novo'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS orcamento_planejamento_socios_itens_company_year_cat_idx
  ON public.orcamento_planejamento_socios_itens (company_id, year, category_code);

DROP TRIGGER IF EXISTS orcamento_planejamento_socios_itens_touch_updated_at_trg ON public.orcamento_planejamento_socios_itens;
CREATE TRIGGER orcamento_planejamento_socios_itens_touch_updated_at_trg
BEFORE UPDATE ON public.orcamento_planejamento_socios_itens
FOR EACH ROW EXECUTE FUNCTION public.orcamento_touch_updated_at();

-- ─── RLS — admin-only, como o resto do módulo ───────────────────────────────
ALTER TABLE public.orcamento_planejamento_socios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "orcamento_planejamento_socios admin all" ON public.orcamento_planejamento_socios;
CREATE POLICY "orcamento_planejamento_socios admin all"
ON public.orcamento_planejamento_socios
FOR ALL TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());

ALTER TABLE public.orcamento_planejamento_socios_itens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "orcamento_planejamento_socios_itens admin all" ON public.orcamento_planejamento_socios_itens;
CREATE POLICY "orcamento_planejamento_socios_itens admin all"
ON public.orcamento_planejamento_socios_itens
FOR ALL TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ─── RPC: realizado do ano anterior, quebrado por FORNECEDOR ─────────────────
-- Lista as plataformas/serviços já pagos numa categoria no ano-base, com o total
-- do ano por fornecedor. Agrega no servidor (SECURITY DEFINER) para NÃO bater no
-- teto de 1000 linhas do PostgREST — é a referência que a IA usa para perguntar
-- "manter cada uma?". Só despesas; soma em módulo (valor positivo).
CREATE OR REPLACE FUNCTION public.orcamento_planejamento_realizado_itens(
  p_company_id uuid,
  p_base_year integer,
  p_category_code text
)
RETURNS TABLE (fornecedor text, total numeric, lancamentos bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(NULLIF(btrim(supplier_customer), ''), 'Sem fornecedor') AS fornecedor,
    round(abs(sum(value))::numeric, 2) AS total,
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

-- Recarrega o cache de schema da API (PostgREST) para as tabelas/função novas
-- aparecerem imediatamente.
NOTIFY pgrst, 'reload schema';
