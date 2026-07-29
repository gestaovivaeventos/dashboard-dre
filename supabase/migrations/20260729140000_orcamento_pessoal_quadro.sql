-- =============================================================================
-- Módulo Orçamento — Despesas com pessoal, ETAPA 1 (quadro de colaboradores).
--
-- Primeira etapa da tela (a "parte azul" da planilha atual): o quadro de
-- colaboradores com vínculo, cargo/salário atual, até 2 movimentações previstas
-- (cada uma = tipo + data + cargo + salário) e uma justificativa. Os benefícios
-- (parte verde) e o motor de encargos/13º/férias virão em etapas próprias.
--
-- POR EMPRESA × ANO (versionado como o resto do módulo). Se a empresa orça por
-- setor naquele ano, cada colaborador pertence a um setor (setor_id); senão
-- setor_id fica NULL (quadro único). O salário vem do Plano de Cargos (nível),
-- mas é gravado como VALOR (snapshot editável), não como referência viva — o
-- que mantém o orçamento do ano congelado.
--
-- Movimentação: 'movimentacao' (mudança de cargo, com cargo+salário novos) ou
-- 'desligamento' (rescisão, sem cargo/salário). Ambas têm data (mês).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.orcamento_pessoal_colaboradores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  -- Setor do orçamento (só quando a empresa orça por setor); NULL = quadro único.
  setor_id uuid REFERENCES public.orcamento_setores(id) ON DELETE SET NULL,

  nome text,
  vinculo text NOT NULL CHECK (vinculo IN ('clt', 'pj', 'estagio')),
  cargo_atual text,
  salario_atual numeric CHECK (salario_atual IS NULL OR salario_atual >= 0),

  -- Movimentação 1
  mov1_tipo text CHECK (mov1_tipo IN ('movimentacao', 'desligamento')),
  mov1_data date,
  mov1_cargo text,
  mov1_salario numeric CHECK (mov1_salario IS NULL OR mov1_salario >= 0),

  -- Movimentação 2
  mov2_tipo text CHECK (mov2_tipo IN ('movimentacao', 'desligamento')),
  mov2_data date,
  mov2_cargo text,
  mov2_salario numeric CHECK (mov2_salario IS NULL OR mov2_salario >= 0),

  justificativa text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

-- Leitura do quadro por empresa/ano/setor.
CREATE INDEX IF NOT EXISTS orcamento_pessoal_colab_company_year_setor_idx
  ON public.orcamento_pessoal_colaboradores (company_id, year, setor_id);

DROP TRIGGER IF EXISTS orcamento_pessoal_colab_touch_updated_at_trg
  ON public.orcamento_pessoal_colaboradores;
CREATE TRIGGER orcamento_pessoal_colab_touch_updated_at_trg
BEFORE UPDATE ON public.orcamento_pessoal_colaboradores
FOR EACH ROW EXECUTE FUNCTION public.orcamento_touch_updated_at();

-- ─── RLS — admin-only, como o resto do módulo ───────────────────────────────
ALTER TABLE public.orcamento_pessoal_colaboradores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orcamento_pessoal_colab admin all"
ON public.orcamento_pessoal_colaboradores
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());
