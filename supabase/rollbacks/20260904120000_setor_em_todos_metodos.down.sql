-- =============================================================================
-- ROLLBACK da FASE 1 (migration 20260904120000) — volta o Orçamento à Fase 0.
--
-- NÃO é aplicado por `db push`: esta pasta existe fora de supabase/migrations
-- justamente para não rodar sozinha. Rode à mão no SQL Editor se a Fase 1 der
-- errado.
--
-- O que ele desfaz: as colunas setor_id dos métodos, as chaves únicas novas, a
-- tabela de atribuição categoria->setores e o vínculo com o setor do Compras.
--
-- O que ele NÃO desfaz: os setores "Não atribuído" criados. Eles são apagados
-- no fim, mas SÓ se nada mais apontar para eles — se alguém já tiver movido
-- orçamento para lá conscientemente, o DELETE falha e é isso mesmo que se quer.
--
-- Os dados em si não se perdem: as linhas de orçamento continuam onde estavam;
-- só a coluna que dizia o setor some. O snapshot em backups/orcamento-fase0-*
-- cobre o caso extremo de precisar reconstruir do zero.
-- =============================================================================

-- ─── 1. Chaves únicas voltam a ignorar o setor ──────────────────────────────
ALTER TABLE public.orcamento_media_categorias
  DROP CONSTRAINT IF EXISTS orcamento_media_categorias_company_year_categoria_setor_key;
ALTER TABLE public.orcamento_planejamento_socios
  DROP CONSTRAINT IF EXISTS orcamento_planejamento_socios_company_year_categ_setor_key;

ALTER TABLE public.orcamento_media_categorias
  ADD CONSTRAINT orcamento_media_categorias_company_id_year_category_code_key
  UNIQUE (company_id, year, category_code);
ALTER TABLE public.orcamento_planejamento_socios
  ADD CONSTRAINT orcamento_planejamento_socios_company_id_year_category_code_key
  UNIQUE (company_id, year, category_code);

-- ─── 2. Índices e colunas de setor ──────────────────────────────────────────
DROP INDEX IF EXISTS public.orcamento_media_categorias_setor_idx;
DROP INDEX IF EXISTS public.orcamento_valor_fixo_categorias_setor_idx;
DROP INDEX IF EXISTS public.orcamento_planejamento_socios_setor_idx;
DROP INDEX IF EXISTS public.orcamento_planejamento_socios_itens_setor_idx;

ALTER TABLE public.orcamento_media_categorias DROP COLUMN IF EXISTS setor_id;
ALTER TABLE public.orcamento_valor_fixo_categorias DROP COLUMN IF EXISTS setor_id;
ALTER TABLE public.orcamento_planejamento_socios DROP COLUMN IF EXISTS setor_id;
ALTER TABLE public.orcamento_planejamento_socios_itens DROP COLUMN IF EXISTS setor_id;

-- ─── 3. Atribuição categoria -> setores ─────────────────────────────────────
DROP TABLE IF EXISTS public.orcamento_categoria_setores;

-- ─── 4. Ponte com o setor do Compras ────────────────────────────────────────
DROP INDEX IF EXISTS public.orcamento_setores_ctrl_sector_idx;
ALTER TABLE public.orcamento_setores DROP COLUMN IF EXISTS ctrl_sector_id;

-- ─── 5. Setores "Não atribuído" criados pela Fase 1 ─────────────────────────
-- Só saem se ninguém mais depender deles. Colaborador do quadro APONTA para
-- setor, então a checagem cobre também o pessoal.
DELETE FROM public.orcamento_setores s
WHERE lower(s.name) = 'não atribuído'
  AND NOT EXISTS (
    SELECT 1 FROM public.orcamento_pessoal_colaboradores c WHERE c.setor_id = s.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.orcamento_cargos g WHERE g.setor_id = s.id
  );
