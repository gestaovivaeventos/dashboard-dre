-- =============================================================================
-- Módulo Orçamento — FASE 1: setor em TODOS os métodos.
--
-- Até aqui só o quadro de pessoal tinha setor. Média, valor fixo e planejamento
-- eram chaveados por (empresa, ano, categoria), sem setor nenhum — então não
-- havia como orçar "Marketing do Comercial" e "Marketing do Produto" em
-- separado, nem acompanhar depois por setor.
--
-- MODELO: a CATEGORIA tem N setores; cada DESPESA tem UM setor. "Marketing"
-- pode existir em vários setores, mas cada item dentro dela pertence a um só.
-- Por isso a chave dos métodos passa a incluir o setor.
--
-- MIGRACAO DO QUE JA EXISTE: nada é apagado nem fica órfão. Cada empresa/ano
-- que já tem orçamento ganha um setor "Não atribuído", e todas as linhas atuais
-- vão para ele. É dívida VISÍVEL de propósito: enquanto houver linha ali, o
-- orçamento por setor não fecha, e a tela cobra a distribuição.
--
-- Rollback: supabase/rollbacks/20260904120000_setor_em_todos_metodos.down.sql
-- =============================================================================

-- ─── 1. Ponte com o setor do módulo Compras ─────────────────────────────────
-- user_sectors liga usuário -> ctrl_sectors. O orçamento tem cadastro próprio
-- (por empresa E por ano, que o do Compras não tem), então em vez de unificar,
-- ligamos os dois. É esta coluna que a Fase 3 usará para saber quais setores um
-- gerente alcança. Anulável: setor sem correspondência no Compras continua
-- valendo para orçar, só não terá dono.
ALTER TABLE public.orcamento_setores
  ADD COLUMN IF NOT EXISTS ctrl_sector_id uuid
    REFERENCES public.ctrl_sectors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS orcamento_setores_ctrl_sector_idx
  ON public.orcamento_setores (ctrl_sector_id);

-- ─── 2. Setor de transição "Não atribuído" ──────────────────────────────────
-- Um por (empresa, ano) que JÁ tenha orçamento em qualquer método. Não é criado
-- para empresa sem dado: não faz sentido nascer dívida onde não há nada.
INSERT INTO public.orcamento_setores (company_id, year, name, active)
SELECT DISTINCT c.company_id, c.year, 'Não atribuído', true
FROM (
  SELECT company_id, year FROM public.orcamento_media_categorias
  UNION SELECT company_id, year FROM public.orcamento_valor_fixo_categorias
  UNION SELECT company_id, year FROM public.orcamento_planejamento_socios
) AS c
WHERE NOT EXISTS (
  SELECT 1 FROM public.orcamento_setores s
  WHERE s.company_id = c.company_id AND s.year = c.year AND lower(s.name) = 'não atribuído'
);

-- ─── 3. setor_id nas três tabelas de método ─────────────────────────────────
-- ON DELETE RESTRICT é deliberado: apagar um setor que tem orçamento tem de
-- falhar, não zerar em silêncio a linha do orçamento.
ALTER TABLE public.orcamento_media_categorias
  ADD COLUMN IF NOT EXISTS setor_id uuid REFERENCES public.orcamento_setores(id) ON DELETE RESTRICT;
ALTER TABLE public.orcamento_valor_fixo_categorias
  ADD COLUMN IF NOT EXISTS setor_id uuid REFERENCES public.orcamento_setores(id) ON DELETE RESTRICT;
ALTER TABLE public.orcamento_planejamento_socios
  ADD COLUMN IF NOT EXISTS setor_id uuid REFERENCES public.orcamento_setores(id) ON DELETE RESTRICT;
-- Os itens seguem o pai (categoria x setor), mas carregam o setor também para a
-- Prévia não precisar de join a cada leitura.
ALTER TABLE public.orcamento_planejamento_socios_itens
  ADD COLUMN IF NOT EXISTS setor_id uuid REFERENCES public.orcamento_setores(id) ON DELETE RESTRICT;

-- ─── 4. Backfill para "Não atribuído" ───────────────────────────────────────
UPDATE public.orcamento_media_categorias m
SET setor_id = s.id
FROM public.orcamento_setores s
WHERE m.setor_id IS NULL
  AND s.company_id = m.company_id AND s.year = m.year AND lower(s.name) = 'não atribuído';

UPDATE public.orcamento_valor_fixo_categorias v
SET setor_id = s.id
FROM public.orcamento_setores s
WHERE v.setor_id IS NULL
  AND s.company_id = v.company_id AND s.year = v.year AND lower(s.name) = 'não atribuído';

UPDATE public.orcamento_planejamento_socios p
SET setor_id = s.id
FROM public.orcamento_setores s
WHERE p.setor_id IS NULL
  AND s.company_id = p.company_id AND s.year = p.year AND lower(s.name) = 'não atribuído';

UPDATE public.orcamento_planejamento_socios_itens i
SET setor_id = s.id
FROM public.orcamento_setores s
WHERE i.setor_id IS NULL
  AND s.company_id = i.company_id AND s.year = i.year AND lower(s.name) = 'não atribuído';

-- ─── 5. Chaves únicas passam a incluir o setor ──────────────────────────────
-- Drop por DESCOBERTA: os nomes foram gerados pelo Postgres na criação inline.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conrelid::regclass AS tabela, conname
    FROM pg_constraint
    WHERE contype = 'u'
      AND conrelid IN (
        'public.orcamento_media_categorias'::regclass,
        'public.orcamento_planejamento_socios'::regclass
      )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tabela, r.conname);
  END LOOP;
END $$;

ALTER TABLE public.orcamento_media_categorias
  ADD CONSTRAINT orcamento_media_categorias_company_year_categoria_setor_key
  UNIQUE (company_id, year, category_code, setor_id);

ALTER TABLE public.orcamento_planejamento_socios
  ADD CONSTRAINT orcamento_planejamento_socios_company_year_categ_setor_key
  UNIQUE (company_id, year, category_code, setor_id);

-- valor_fixo NAO ganha unique: a categoria já admite N contratos por linha
-- (a migration 20260820120000 removeu o unique de propósito), e agora N por setor.

CREATE INDEX IF NOT EXISTS orcamento_media_categorias_setor_idx
  ON public.orcamento_media_categorias (company_id, year, setor_id);
CREATE INDEX IF NOT EXISTS orcamento_valor_fixo_categorias_setor_idx
  ON public.orcamento_valor_fixo_categorias (company_id, year, setor_id);
CREATE INDEX IF NOT EXISTS orcamento_planejamento_socios_setor_idx
  ON public.orcamento_planejamento_socios (company_id, year, setor_id);
CREATE INDEX IF NOT EXISTS orcamento_planejamento_socios_itens_setor_idx
  ON public.orcamento_planejamento_socios_itens (company_id, year, setor_id);

-- ─── 6. Quais setores participam de cada categoria ──────────────────────────
-- Sem isto, toda categoria x todo setor viraria card (20 x 8 = 160). Só o setor
-- ATRIBUÍDO à categoria gera linha de orçamento. O método continua sendo da
-- categoria (orcamento_categoria_metodo), não do setor.
CREATE TABLE IF NOT EXISTS public.orcamento_categoria_setores (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  category_code text NOT NULL,
  setor_id uuid NOT NULL REFERENCES public.orcamento_setores(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  PRIMARY KEY (company_id, year, category_code, setor_id)
);

CREATE INDEX IF NOT EXISTS orcamento_categoria_setores_setor_idx
  ON public.orcamento_categoria_setores (setor_id);

ALTER TABLE public.orcamento_categoria_setores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orcamento_categoria_setores admin all"
  ON public.orcamento_categoria_setores;
CREATE POLICY "orcamento_categoria_setores admin all"
ON public.orcamento_categoria_setores
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Backfill: cada categoria que já tem orçamento fica atribuída ao setor em que
-- ele está, para as telas continuarem mostrando exatamente o que mostravam.
INSERT INTO public.orcamento_categoria_setores (company_id, year, category_code, setor_id)
SELECT DISTINCT company_id, year, category_code, setor_id
FROM (
  SELECT company_id, year, category_code, setor_id FROM public.orcamento_media_categorias
  UNION SELECT company_id, year, category_code, setor_id FROM public.orcamento_valor_fixo_categorias
  UNION SELECT company_id, year, category_code, setor_id FROM public.orcamento_planejamento_socios
) AS x
WHERE setor_id IS NOT NULL
ON CONFLICT DO NOTHING;
