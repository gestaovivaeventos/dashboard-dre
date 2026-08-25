-- =============================================================================
-- Módulo Orçamento — método PLANEJAMENTO DOS SÓCIOS (entrevista conduzida por IA).
--
-- Categorias marcadas com o método 'planejamento_socios' na tela "Método de
-- orçamento por categoria" (orcamento_categoria_metodo) são orçadas por uma
-- ENTREVISTA guiada por IA (Gemini): a IA faz perguntas ao gestor, e ao final
-- propõe os 12 valores mensais da categoria (com sazonalidade) + a justificativa
-- das premissas. O orçado cai na MESMA linha da DRE da categoria na Prévia.
--
-- Uma linha por (empresa, ano, categoria). Guarda:
--   - valores        : os 12 valores mensais DECIDIDOS (jsonb array de 12 números;
--                       null = ainda não definido). Congela o ano (valor, não
--                       fórmula viva) — princípio do módulo.
--   - justificativa  : as premissas em texto (o "porquê" do número).
--   - conversa       : o transcript completo do chat com a IA (auditoria) —
--                       jsonb array de { role: 'user'|'assistant', content }.
--   - status         : 'rascunho' (em entrevista) | 'concluido' (valores salvos).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.orcamento_planejamento_socios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  category_code text NOT NULL,
  category_name text,
  -- 12 valores mensais decididos (jan..dez). null = categoria ainda não orçada.
  valores jsonb,
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

-- status ∈ {rascunho, concluido} — constraint via guard idempotente (evita erro
-- ao reaplicar; o nome fica curto de propósito, dentro dos 63 chars).
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

-- ─── RLS — admin-only, como o resto do módulo ───────────────────────────────
ALTER TABLE public.orcamento_planejamento_socios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orcamento_planejamento_socios admin all" ON public.orcamento_planejamento_socios;
CREATE POLICY "orcamento_planejamento_socios admin all"
ON public.orcamento_planejamento_socios
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Recarrega o cache de schema da API (PostgREST) para a tabela nova aparecer
-- imediatamente — sem isso a API pode responder "relation/column does not exist"
-- mesmo com a tabela já criada.
NOTIFY pgrst, 'reload schema';
