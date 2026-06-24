-- =============================================================================
-- Controle de Projetos da FEAT PRODUÇÕES (Painel Administrador)
-- -----------------------------------------------------------------------------
-- Cadastro gerencial de projetos/eventos da empresa Feat Produções, análogo —
-- em arquitetura — ao botão FEE/VVR das Franquias Viva, porém com estrutura
-- própria e EXCLUSIVA da Feat Produções.
--
-- Tabela puramente para registro manual / contexto futuro da tela Business
-- Intelligence. NÃO interfere em nenhum cálculo de DRE, Fluxo de Caixa, KPIs,
-- Orçamento, Omie ou Google Sheets. Cada registro é vinculado a uma única
-- empresa via company_id (isolamento por empresa garantido pela FK + RLS).
--
-- O escopo "apenas Feat Produções" é aplicado na camada de aplicação (UI mostra
-- a seção só para a empresa Feat Produções; a API valida o nome da empresa).
-- A tabela em si é genérica por company_id, mas nenhuma outra empresa recebe a
-- interface para gravar nela.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.company_feat_projetos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  projeto text NOT NULL DEFAULT '',
  tipo_evento text CHECK (tipo_evento IN ('Corporativo', 'Show', 'Licitação')),
  resultado_previsto numeric,
  resultado_realizado numeric,
  fechamento text CHECK (
    fechamento IN ('Realizado', 'Em aberto', 'Evento previsto e não realizado')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS company_feat_projetos_company_idx
  ON public.company_feat_projetos (company_id, year, month);

-- updated_at automatico via trigger.
CREATE OR REPLACE FUNCTION public.company_feat_projetos_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_feat_projetos_touch_updated_at_trg ON public.company_feat_projetos;
CREATE TRIGGER company_feat_projetos_touch_updated_at_trg
BEFORE UPDATE ON public.company_feat_projetos
FOR EACH ROW EXECUTE FUNCTION public.company_feat_projetos_touch_updated_at();

-- ─── RLS (mesmo padrão de company_fee_vvr) ──────────────────────────────────
ALTER TABLE public.company_feat_projetos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read company_feat_projetos by permission"
ON public.company_feat_projetos
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

CREATE POLICY "Write company_feat_projetos admin"
ON public.company_feat_projetos
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());
