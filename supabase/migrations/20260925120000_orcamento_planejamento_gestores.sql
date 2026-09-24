-- =============================================================================
-- Módulo Orçamento — Planejamento dos gestores, modelo novo.
--
-- A tela antiga (categoria → base → entrevista → proposta jsonb) foi refeita do
-- zero. O que muda no MODELO, e por quê:
--
-- 1. GRUPOS DE DESPESA (cadastro novo, por empresa). É o subnível que faltava
--    entre a categoria da DRE e a despesa: "Softwares" vira "Softwares ›
--    Design › Figma". Cadastro do administrador, por EMPRESA e sem ano — a
--    lista atravessa os exercícios (diferente de `orcamento_setores`, que é por
--    empresa × ano). Não confundir com `ctrl_expense_types` (os "Tipos de
--    despesa" do Compras): são cadastros distintos, de propósito — decisão do
--    dono do projeto em 23/09/2026.
--
-- 2. A DESPESA VIRA LINHA DE TABELA. Antes o item orçado vivia dentro do jsonb
--    `orcamento_planejamento_socios.proposta`, e por isso cancelar era mexer no
--    objeto (ver validacao.ts) e a trava da diretoria teve de morar na linha
--    pai (migration 20260924120000). Com linha de verdade, cada despesa tem id,
--    trava e cancelamento próprios — que é o que a validação item a item sempre
--    quis.
--
-- 3. A DESPESA É GRAVADA ITEM A ITEM, durante a entrevista, e não numa proposta
--    montada no fim. É o que permite a PRÉVIA EM TEMPO REAL embaixo do chat: a
--    cada despesa fechada, a prévia do setor reflete. De quebra a entrevista
--    fica retomável — no modelo antigo, quem saía no meio perdia o que tinha
--    construído.
--
-- 4. A CONVERSA É POR CATEGORIA × SETOR. O card da lista é por categoria, mas
--    a mesma categoria pode pertencer a vários setores (Marketing do Comercial
--    e Marketing do Produto). Uma conversa só por categoria faria dois gestores
--    escreverem um por cima do outro, e a IA misturaria contextos de setores
--    diferentes — o que arruína a entrevista base zero.
--
-- 5. A BASE guarda o que o setor gastou na categoria no ano anterior, curada
--    pelo ADMINISTRADOR e somente leitura para o gestor. Só nome (editável) e
--    valor pago no ano: é referência histórica, não orçamento — quem produz
--    número é a entrevista.
--
-- Esta migration só CRIA. As tabelas antigas (`orcamento_planejamento_socios` e
-- `_itens`) continuam de pé para o código atual seguir funcionando até o deploy
-- da tela nova; a remoção delas é uma migration à parte, depois.
--
-- Idempotente: pode rodar duas vezes.
-- =============================================================================

-- ─── 1) Grupos de despesa ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.orcamento_grupos_despesa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- Inativar em vez de apagar: grupo já usado por uma despesa de um ano
  -- fechado continua precisando de nome na Prévia e nos comparativos.
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

-- Nome único por empresa, ignorando caixa e contando inativos — senão o admin
-- recria "Design" ao lado de "design" e a Prévia mostra dois subníveis iguais.
CREATE UNIQUE INDEX IF NOT EXISTS orcamento_grupos_despesa_company_name_lower_idx
  ON public.orcamento_grupos_despesa (company_id, lower(name));

CREATE INDEX IF NOT EXISTS orcamento_grupos_despesa_company_idx
  ON public.orcamento_grupos_despesa (company_id, active);

DROP TRIGGER IF EXISTS orcamento_grupos_despesa_touch_updated_at_trg
  ON public.orcamento_grupos_despesa;
CREATE TRIGGER orcamento_grupos_despesa_touch_updated_at_trg
BEFORE UPDATE ON public.orcamento_grupos_despesa
FOR EACH ROW EXECUTE FUNCTION public.orcamento_touch_updated_at();

-- ─── 2) Base do ano anterior (curadoria do administrador) ────────────────────
CREATE TABLE IF NOT EXISTS public.orcamento_planejamento_base (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Ano do ORÇAMENTO (2027), não o ano dos pagamentos (2026). A base é lida
  -- sempre no contexto do orçamento que está sendo montado.
  year integer NOT NULL,
  category_code text NOT NULL,
  setor_id uuid REFERENCES public.orcamento_setores(id) ON DELETE RESTRICT,
  -- Nome de exibição, editável pelo admin ("DIVERSOS" → "Trello").
  nome text NOT NULL,
  -- O que saiu no ano anterior. Valor do ANO, não mensal: a base é história, e
  -- distribuir isso por mês daria falsa precisão.
  valor_ano numeric NOT NULL DEFAULT 0,
  grupo_id uuid REFERENCES public.orcamento_grupos_despesa(id) ON DELETE SET NULL,
  -- Fornecedor original no lançamento da Omie. É a CHAVE de reconciliação
  -- quando a base é semeada de novo: preserva a curadoria já feita.
  fornecedor text,
  -- Quantos lançamentos a Omie tinha para este fornecedor na categoria.
  lancamentos integer NOT NULL DEFAULT 0,
  -- Desconsiderar uma linha sem apagá-la: fica visível, riscada, e não volta a
  -- ser sugerida na próxima semeadura.
  incluir boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS orcamento_planejamento_base_escopo_idx
  ON public.orcamento_planejamento_base (company_id, year, category_code, setor_id);

DROP TRIGGER IF EXISTS orcamento_planejamento_base_touch_updated_at_trg
  ON public.orcamento_planejamento_base;
CREATE TRIGGER orcamento_planejamento_base_touch_updated_at_trg
BEFORE UPDATE ON public.orcamento_planejamento_base
FOR EACH ROW EXECUTE FUNCTION public.orcamento_touch_updated_at();

-- ─── 3) Entrevista (uma por categoria × setor) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.orcamento_planejamento_entrevistas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  category_code text NOT NULL,
  setor_id uuid REFERENCES public.orcamento_setores(id) ON DELETE RESTRICT,
  category_name text,
  -- Base finalizada pelo admin: é o que destrava a entrevista para o gestor.
  base_salva boolean NOT NULL DEFAULT false,
  -- Orientação livre que o admin escreve para a IA daquela categoria × setor.
  contexto_admin text,
  -- Transcript: [{ "role": "user"|"assistant", "content": "…" }].
  conversa jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Justificativa do CONJUNTO, escrita pela IA ao fechar a entrevista. É o
  -- texto que a Diretoria lê na validação; a defesa de cada despesa não tem
  -- campo próprio (ver o comentário em `orcamento_planejamento_despesas`).
  justificativa text,
  status text NOT NULL DEFAULT 'rascunho',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

-- Chave do escopo. COALESCE porque setor_id nulo (empresa que não orça por
-- setor) é valor legítimo, e um UNIQUE comum deixaria passar duplicata com NULL.
CREATE UNIQUE INDEX IF NOT EXISTS orcamento_planejamento_entrevistas_escopo_idx
  ON public.orcamento_planejamento_entrevistas
     (company_id, year, category_code,
      COALESCE(setor_id, '00000000-0000-0000-0000-000000000000'::uuid));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orcamento_planejamento_entrevistas_status_chk'
      AND conrelid = 'public.orcamento_planejamento_entrevistas'::regclass
  ) THEN
    ALTER TABLE public.orcamento_planejamento_entrevistas
      ADD CONSTRAINT orcamento_planejamento_entrevistas_status_chk
      CHECK (status IN ('rascunho', 'concluido'));
  END IF;
END $$;

DROP TRIGGER IF EXISTS orcamento_planejamento_entrevistas_touch_updated_at_trg
  ON public.orcamento_planejamento_entrevistas;
CREATE TRIGGER orcamento_planejamento_entrevistas_touch_updated_at_trg
BEFORE UPDATE ON public.orcamento_planejamento_entrevistas
FOR EACH ROW EXECUTE FUNCTION public.orcamento_touch_updated_at();

-- ─── 4) Despesas orçadas (o número que vai para a Prévia) ────────────────────
CREATE TABLE IF NOT EXISTS public.orcamento_planejamento_despesas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  category_code text NOT NULL,
  -- Cada despesa pertence a UM setor — é o invariante do modelo por setor.
  setor_id uuid REFERENCES public.orcamento_setores(id) ON DELETE RESTRICT,
  -- Nulo é dívida VISÍVEL, não erro: a despesa aparece na Prévia sob "Sem
  -- grupo" e a tela cobra a classificação. RESTRICT para que apagar um grupo
  -- em uso falhe, em vez de esvaziar o subnível em silêncio.
  grupo_id uuid REFERENCES public.orcamento_grupos_despesa(id) ON DELETE RESTRICT,
  descricao text NOT NULL,
  -- Valor de CADA pagamento (mensal na periodicidade mensal, do trimestre na
  -- trimestral…), igual ao modelo antigo — ver serieItem() em
  -- src/lib/orcamento/planejamento-calc.ts, que continua sendo o motor.
  valor numeric NOT NULL DEFAULT 0 CHECK (valor >= 0),
  periodicidade text NOT NULL DEFAULT 'mensal',
  mes_inicio integer NOT NULL DEFAULT 1 CHECK (mes_inicio BETWEEN 1 AND 12),
  mes_fim integer CHECK (mes_fim BETWEEN 1 AND 12),
  fornecedor text,
  -- 'base' = continuação de algo que já era pago (veio da base do ano anterior)
  -- 'nova' = despesa que não existia
  origem text NOT NULL DEFAULT 'nova',
  base_id uuid REFERENCES public.orcamento_planejamento_base(id) ON DELETE SET NULL,

  -- NÃO há coluna para KPI, impacto, finalidade ou prioridade — e isso é uma
  -- decisão, não um esquecimento (dono do projeto, 23/09/2026). A IA faz essas
  -- perguntas para INSTIGAR A REFLEXÃO de quem está orçando; a resposta é o
  -- raciocínio do gestor, e ele fica no transcript da entrevista
  -- (`orcamento_planejamento_entrevistas.conversa`) junto com a pergunta que o
  -- provocou. Transformá-las em campo mudaria a natureza da coisa: viraria
  -- formulário a preencher, que é exatamente o que a entrevista veio substituir.
  -- Se um dia a diretoria precisar ler item a item, o caminho é a justificativa
  -- do conjunto na entrevista, não quatro caixas de texto por despesa.

  -- ── Validação da diretoria ────────────────────────────────────────────────
  cancelado boolean NOT NULL DEFAULT false,
  cancelado_motivo text,
  cancelado_por uuid REFERENCES public.users(id) ON DELETE SET NULL,
  cancelado_em timestamptz,
  diretoria_travado boolean NOT NULL DEFAULT false,
  diretoria_alterado_em timestamptz,
  diretoria_alterado_por uuid REFERENCES public.users(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orcamento_planejamento_despesas_periodicidade_chk'
      AND conrelid = 'public.orcamento_planejamento_despesas'::regclass
  ) THEN
    ALTER TABLE public.orcamento_planejamento_despesas
      ADD CONSTRAINT orcamento_planejamento_despesas_periodicidade_chk
      CHECK (periodicidade IN ('mensal', 'bimestral', 'trimestral', 'semestral', 'anual'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orcamento_planejamento_despesas_origem_chk'
      AND conrelid = 'public.orcamento_planejamento_despesas'::regclass
  ) THEN
    ALTER TABLE public.orcamento_planejamento_despesas
      ADD CONSTRAINT orcamento_planejamento_despesas_origem_chk
      CHECK (origem IN ('base', 'nova'));
  END IF;

END $$;

-- Leitura da Prévia: empresa × ano, filtrando setor/categoria.
CREATE INDEX IF NOT EXISTS orcamento_planejamento_despesas_escopo_idx
  ON public.orcamento_planejamento_despesas (company_id, year, category_code, setor_id);
CREATE INDEX IF NOT EXISTS orcamento_planejamento_despesas_setor_idx
  ON public.orcamento_planejamento_despesas (company_id, year, setor_id);
CREATE INDEX IF NOT EXISTS orcamento_planejamento_despesas_grupo_idx
  ON public.orcamento_planejamento_despesas (grupo_id);

DROP TRIGGER IF EXISTS orcamento_planejamento_despesas_touch_updated_at_trg
  ON public.orcamento_planejamento_despesas;
CREATE TRIGGER orcamento_planejamento_despesas_touch_updated_at_trg
BEFORE UPDATE ON public.orcamento_planejamento_despesas
FOR EACH ROW EXECUTE FUNCTION public.orcamento_touch_updated_at();

-- ─── 5) RLS ──────────────────────────────────────────────────────────────────
-- Mesmo enquadramento do resto do módulo (migration 20260922120000): LEITURA
-- aberta a quem tem o módulo e alcança a empresa; ESCRITA só `is_admin()` na
-- policy, porque o caminho real de gravação é o service role nas server actions,
-- onde o recorte por setor é aplicado (`autorizarEscrita` + `podeEscreverNoSetor`
-- em src/lib/orcamento/auth.ts).
DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY[
    'orcamento_grupos_despesa',
    'orcamento_planejamento_base',
    'orcamento_planejamento_entrevistas',
    'orcamento_planejamento_despesas'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || ' admin all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      'USING (public.is_admin()) WITH CHECK (public.is_admin())',
      t || ' admin all', t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || ' orcamento read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
      'USING (public.orcamento_pode_ler_empresa(company_id))',
      t || ' orcamento read', t
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
