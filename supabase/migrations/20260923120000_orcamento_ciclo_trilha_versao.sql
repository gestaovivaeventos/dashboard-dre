-- =============================================================================
-- Módulo Orçamento — FASE B do ciclo construção → validação → retorno.
-- Spec: docs/superpowers/specs/2026-09-22-orcamento-ciclo-validacao-design.md
--
-- Quatro peças, nesta ordem de dependência:
--   1. orcamento_ciclos          — o estado do orçamento de uma empresa × ano
--   2. orcamento_setor_entregas  — "terminei o meu setor", por rodada
--   3. orcamento_versoes (+ _linhas) — o snapshot congelado a cada transição
--   4. orcamento_alteracoes      — a trilha de TODA escrita do módulo
--   5. colunas de trava da diretoria e de cancelamento nas tabelas de item
--
-- Por que congelar agora, antes de existir tela que leia as versões: snapshot
-- não se faz retroativamente. O dado ao vivo guarda só o estado corrente, então
-- o que não for gravado aqui não existirá para o ciclo de 2027 — inclusive para
-- o comparativo "o que os construtores montaram × o aprovado" (§10.F da spec).
--
-- Idempotente: pode rodar duas vezes.
-- =============================================================================

-- ─── 1) O ciclo ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.orcamento_ciclos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  estado text NOT NULL DEFAULT 'em_construcao',
  -- Incrementa a cada envio para validação. Rodada 0 = nunca saiu da construção.
  rodada integer NOT NULL DEFAULT 0,
  enviado_em timestamptz,
  enviado_por uuid REFERENCES public.users(id) ON DELETE SET NULL,
  validado_em timestamptz,
  validado_por uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ajuste_concluido_em timestamptz,
  ajuste_concluido_por uuid REFERENCES public.users(id) ON DELETE SET NULL,
  publicado_em timestamptz,
  publicado_por uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (company_id, year)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orcamento_ciclos_estado_chk'
      AND conrelid = 'public.orcamento_ciclos'::regclass
  ) THEN
    ALTER TABLE public.orcamento_ciclos
      ADD CONSTRAINT orcamento_ciclos_estado_chk
      CHECK (estado IN ('em_construcao', 'em_validacao', 'em_ajuste', 'concluido', 'publicado'));
  END IF;
END $$;

DROP TRIGGER IF EXISTS orcamento_ciclos_touch_updated_at_trg ON public.orcamento_ciclos;
CREATE TRIGGER orcamento_ciclos_touch_updated_at_trg
BEFORE UPDATE ON public.orcamento_ciclos
FOR EACH ROW EXECUTE FUNCTION public.orcamento_touch_updated_at();

-- ─── 2) Entrega por setor ────────────────────────────────────────────────────
-- Tabela própria (e não colunas em orcamento_setores) para a 2ª rodada não
-- herdar as entregas da 1ª: a chave inclui a rodada.
--
-- A entrega é SINAL, não gate: ela diz "terminei o meu setor" e é o que o admin
-- olha antes de fechar a empresa. Não existe trava de "só envia com 100%
-- entregue" — média e valor fixo são do admin e atravessam TODOS os setores,
-- sem que nenhum gerente as entregue; um gate duro travaria o envio em toda
-- empresa que tenha categoria por média (ou seja, em todas).
CREATE TABLE IF NOT EXISTS public.orcamento_setor_entregas (
  ciclo_id uuid NOT NULL REFERENCES public.orcamento_ciclos(id) ON DELETE CASCADE,
  rodada integer NOT NULL,
  setor_id uuid NOT NULL REFERENCES public.orcamento_setores(id) ON DELETE CASCADE,
  entregue_em timestamptz NOT NULL DEFAULT now(),
  entregue_por uuid REFERENCES public.users(id) ON DELETE SET NULL,
  PRIMARY KEY (ciclo_id, rodada, setor_id)
);

CREATE INDEX IF NOT EXISTS orcamento_setor_entregas_setor_idx
  ON public.orcamento_setor_entregas (setor_id);

-- ─── 3) O snapshot ───────────────────────────────────────────────────────────
-- `tipo` é o que permite achar as duas pontas do comparativo sem conhecer os
-- números de rodada: 'construcao' (1º envio — o que os construtores montaram),
-- 'validacao' (cada reenvio) e 'final' (o aprovado, no Concluir).
--
-- A tabela é ADITIVA: nenhuma versão é sobrescrita nem apagada. Reabrir um
-- ciclo concluído gera uma 'final' nova com o número seguinte.
--
-- company_id/year são denormalizados de propósito (já estão no ciclo): tornam a
-- policy de leitura e as consultas do comparativo diretas, sem join.
CREATE TABLE IF NOT EXISTS public.orcamento_versoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ciclo_id uuid NOT NULL REFERENCES public.orcamento_ciclos(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  numero integer NOT NULL,
  tipo text NOT NULL,
  total_ano numeric NOT NULL DEFAULT 0,
  motivo text,
  -- Formato do payload. Leitor futuro precisa saber o que está lendo.
  payload_schema integer NOT NULL DEFAULT 1,
  payload jsonb NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT now(),
  criada_por uuid REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (ciclo_id, numero, tipo)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orcamento_versoes_tipo_chk'
      AND conrelid = 'public.orcamento_versoes'::regclass
  ) THEN
    ALTER TABLE public.orcamento_versoes
      ADD CONSTRAINT orcamento_versoes_tipo_chk
      CHECK (tipo IN ('construcao', 'validacao', 'final'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS orcamento_versoes_company_year_idx
  ON public.orcamento_versoes (company_id, year, tipo);

-- O mesmo snapshot em forma tabular, para o comparativo somar por setor,
-- categoria ou conta sem abrir jsonb. Nasce do mesmo cálculo, na mesma
-- transação — barata agora e irrecuperável depois.
--
-- PK é um id sintético, NÃO a combinação natural: `setor_id` e `dre_account_id`
-- podem ser nulos (linha sem setor, valor que não caiu em conta da DRE) e NULL
-- não entra em PRIMARY KEY. A tabela é append-only por versão, então
-- unicidade não é o que a protege.
CREATE TABLE IF NOT EXISTS public.orcamento_versao_linhas (
  id bigserial PRIMARY KEY,
  versao_id uuid NOT NULL REFERENCES public.orcamento_versoes(id) ON DELETE CASCADE,
  setor_id uuid REFERENCES public.orcamento_setores(id) ON DELETE SET NULL,
  setor_nome text,
  category_code text,
  category_name text,
  metodo text,
  dre_account_id uuid,
  dre_code text,
  mes integer NOT NULL CHECK (mes BETWEEN 1 AND 12),
  valor numeric NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS orcamento_versao_linhas_versao_idx
  ON public.orcamento_versao_linhas (versao_id);
CREATE INDEX IF NOT EXISTS orcamento_versao_linhas_setor_idx
  ON public.orcamento_versao_linhas (versao_id, setor_id);
CREATE INDEX IF NOT EXISTS orcamento_versao_linhas_categoria_idx
  ON public.orcamento_versao_linhas (versao_id, category_code);

-- ─── 4) A trilha ─────────────────────────────────────────────────────────────
-- Uma linha por escrita no módulo, em QUALQUER fase. Registrar sempre (não só
-- na validação) custa nada e é o que faz "ver tudo o que foi feito" ser
-- completo; a tela de retorno filtra por fase='validacao'.
--
-- company_id/year/category_code/setor_id são denormalizados para agrupar e
-- filtrar sem join. `alvo_rotulo` guarda o nome do item NO MOMENTO: é o que faz
-- o histórico sobreviver a renomeação e ao item apagado.
CREATE TABLE IF NOT EXISTS public.orcamento_alteracoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  ciclo_id uuid REFERENCES public.orcamento_ciclos(id) ON DELETE SET NULL,
  versao_id uuid REFERENCES public.orcamento_versoes(id) ON DELETE SET NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  category_code text,
  setor_id uuid REFERENCES public.orcamento_setores(id) ON DELETE SET NULL,
  metodo text,
  alvo_tipo text NOT NULL,
  alvo_id uuid,
  alvo_rotulo text,
  acao text NOT NULL,
  fase text NOT NULL,
  antes jsonb,
  depois jsonb,
  motivo text,
  -- Só em ação de diretor: espelha o checkbox "Permitir que o gestor ajuste".
  permite_alteracao boolean,
  autor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  autor_papel text,
  -- Só em 'solicitou'/'contestou': o andamento da pendência.
  resolucao text,
  resolvido_em timestamptz,
  resolvido_por uuid REFERENCES public.users(id) ON DELETE SET NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orcamento_alteracoes_acao_chk'
      AND conrelid = 'public.orcamento_alteracoes'::regclass
  ) THEN
    ALTER TABLE public.orcamento_alteracoes
      ADD CONSTRAINT orcamento_alteracoes_acao_chk
      CHECK (acao IN (
        'criou', 'alterou', 'cancelou', 'reativou', 'excluiu',
        'moveu_categoria', 'moveu_setor',
        'solicitou', 'liberou', 'contestou', 'marcou_ciente', 'atendeu',
        'entregou_setor', 'desfez_entrega',
        'enviou_validacao', 'concluiu_validacao', 'reenviou', 'concluiu', 'publicou', 'reabriu'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orcamento_alteracoes_alvo_tipo_chk'
      AND conrelid = 'public.orcamento_alteracoes'::regclass
  ) THEN
    ALTER TABLE public.orcamento_alteracoes
      ADD CONSTRAINT orcamento_alteracoes_alvo_tipo_chk
      CHECK (alvo_tipo IN (
        'colaborador', 'planejamento_item', 'valor_fixo_contrato', 'media_linha',
        'categoria_setor', 'ciclo'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orcamento_alteracoes_fase_chk'
      AND conrelid = 'public.orcamento_alteracoes'::regclass
  ) THEN
    ALTER TABLE public.orcamento_alteracoes
      ADD CONSTRAINT orcamento_alteracoes_fase_chk
      CHECK (fase IN ('construcao', 'validacao', 'ajuste', 'concluido', 'publicado'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orcamento_alteracoes_resolucao_chk'
      AND conrelid = 'public.orcamento_alteracoes'::regclass
  ) THEN
    ALTER TABLE public.orcamento_alteracoes
      ADD CONSTRAINT orcamento_alteracoes_resolucao_chk
      CHECK (resolucao IS NULL OR resolucao IN ('pendente', 'atendida', 'contestada', 'liberada'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS orcamento_alteracoes_empresa_ano_idx
  ON public.orcamento_alteracoes (company_id, year, created_at DESC);
CREATE INDEX IF NOT EXISTS orcamento_alteracoes_ciclo_fase_idx
  ON public.orcamento_alteracoes (ciclo_id, fase);
CREATE INDEX IF NOT EXISTS orcamento_alteracoes_setor_idx
  ON public.orcamento_alteracoes (company_id, year, setor_id);
CREATE INDEX IF NOT EXISTS orcamento_alteracoes_alvo_idx
  ON public.orcamento_alteracoes (alvo_tipo, alvo_id);

-- ─── 5) Trava da diretoria e cancelamento nas tabelas de item ────────────────
-- Trava nas QUATRO tabelas de item: o diretor também troca o índice aplicado em
-- média e valor fixo, e essa troca trava a linha como qualquer outra alteração.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'orcamento_pessoal_colaboradores',
    'orcamento_planejamento_socios_itens',
    'orcamento_valor_fixo_categorias',
    'orcamento_media_categorias'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE public.%I
         ADD COLUMN IF NOT EXISTS diretoria_travado boolean NOT NULL DEFAULT false,
         ADD COLUMN IF NOT EXISTS diretoria_alterado_em timestamptz,
         ADD COLUMN IF NOT EXISTS diretoria_alterado_por uuid', t
    );
  END LOOP;
END $$;

-- Cancelamento SÓ onde o diretor pode cancelar (§8 da spec): colaborador e item
-- do planejamento. Média e valor fixo são do admin — o diretor no máximo troca
-- o índice, então cancelar ali não existe e a coluna seria letra morta.
--
-- Cancelar é MARCA, não exclusão: o item fica visível, riscado, com motivo e
-- autor. Apagar faria o construtor perder o que escreveu e transformaria a
-- trilha no único lugar onde o item existiu.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'orcamento_pessoal_colaboradores',
    'orcamento_planejamento_socios_itens'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE public.%I
         ADD COLUMN IF NOT EXISTS cancelado_em timestamptz,
         ADD COLUMN IF NOT EXISTS cancelado_por uuid,
         ADD COLUMN IF NOT EXISTS cancelado_motivo text', t
    );
    -- Índice parcial: as leituras filtram "item ativo", que é a maioria.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (company_id, year) WHERE cancelado_em IS NULL',
      t || '_ativos_idx', t
    );
  END LOOP;
END $$;

-- ─── 6) RLS ──────────────────────────────────────────────────────────────────
-- Mesmo enquadramento das demais tabelas do módulo: admin faz tudo; quem tem o
-- módulo LÊ dentro do escopo de empresa. A escrita real acontece nas server
-- actions com service role, depois do guard (ver src/lib/orcamento/auth.ts).
ALTER TABLE public.orcamento_ciclos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orcamento_setor_entregas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orcamento_versoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orcamento_versao_linhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orcamento_alteracoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orcamento_ciclos admin all" ON public.orcamento_ciclos;
CREATE POLICY "orcamento_ciclos admin all" ON public.orcamento_ciclos
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "orcamento_ciclos orcamento read" ON public.orcamento_ciclos;
CREATE POLICY "orcamento_ciclos orcamento read" ON public.orcamento_ciclos
  FOR SELECT TO authenticated USING (public.orcamento_pode_ler_empresa(company_id));

DROP POLICY IF EXISTS "orcamento_versoes admin all" ON public.orcamento_versoes;
CREATE POLICY "orcamento_versoes admin all" ON public.orcamento_versoes
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "orcamento_versoes orcamento read" ON public.orcamento_versoes;
CREATE POLICY "orcamento_versoes orcamento read" ON public.orcamento_versoes
  FOR SELECT TO authenticated USING (public.orcamento_pode_ler_empresa(company_id));

DROP POLICY IF EXISTS "orcamento_alteracoes admin all" ON public.orcamento_alteracoes;
CREATE POLICY "orcamento_alteracoes admin all" ON public.orcamento_alteracoes
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "orcamento_alteracoes orcamento read" ON public.orcamento_alteracoes;
CREATE POLICY "orcamento_alteracoes orcamento read" ON public.orcamento_alteracoes
  FOR SELECT TO authenticated USING (public.orcamento_pode_ler_empresa(company_id));

-- Entregas e linhas da versão não têm company_id: herdam pelo pai.
DROP POLICY IF EXISTS "orcamento_setor_entregas admin all" ON public.orcamento_setor_entregas;
CREATE POLICY "orcamento_setor_entregas admin all" ON public.orcamento_setor_entregas
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "orcamento_setor_entregas orcamento read" ON public.orcamento_setor_entregas;
CREATE POLICY "orcamento_setor_entregas orcamento read" ON public.orcamento_setor_entregas
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orcamento_ciclos c
    WHERE c.id = orcamento_setor_entregas.ciclo_id
      AND public.orcamento_pode_ler_empresa(c.company_id)
  ));

DROP POLICY IF EXISTS "orcamento_versao_linhas admin all" ON public.orcamento_versao_linhas;
CREATE POLICY "orcamento_versao_linhas admin all" ON public.orcamento_versao_linhas
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "orcamento_versao_linhas orcamento read" ON public.orcamento_versao_linhas;
CREATE POLICY "orcamento_versao_linhas orcamento read" ON public.orcamento_versao_linhas
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orcamento_versoes v
    WHERE v.id = orcamento_versao_linhas.versao_id
      AND public.orcamento_pode_ler_empresa(v.company_id)
  ));

NOTIFY pgrst, 'reload schema';
