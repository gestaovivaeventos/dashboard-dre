-- =============================================================================
-- Orçamento de VIAGENS — o 5º método do módulo (01/10/2026).
--
-- O solicitante descreve o roteiro conversando com a IA; o CUSTO sai de um
-- motor determinístico (`src/lib/viagens/custo/motor.ts`), nunca do modelo de
-- linguagem. Depois o solicitante envia, e o diretor aprova a viagem INTEIRA
-- olhando a abertura por grupo.
--
-- Este é o DONO do custo de viagem no sistema. O módulo `/viagens` do Marcelo
-- (tabelas `viagem_*`, desligado por kill-switch desde 07/07/2026) fica dormindo
-- como está: nada aqui depende dele, e quando a cotação de COMPRA for refeita,
-- é este motor que vai atendê-la.
-- =============================================================================

-- ── Parâmetros: o que ancora a estimativa ────────────────────────────────────
-- Por EMPRESA × ANO, como encargos e índices — a diária de 2027 não é a de
-- 2026, e é o admin quem a define. É daqui que sai todo número que a IA não
-- inventou: ela monta o roteiro, a conta vem destes valores.
CREATE TABLE IF NOT EXISTS public.orcamento_viagem_parametros (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year integer NOT NULL,

  rs_por_km numeric(10,2) NOT NULL DEFAULT 1.80,
  preco_combustivel_litro numeric(10,2) NOT NULL DEFAULT 6.20,
  consumo_km_litro numeric(10,2) NOT NULL DEFAULT 11.00,
  tarifa_onibus_km numeric(10,4) NOT NULL DEFAULT 0.4200,
  diaria_alimentacao numeric(10,2) NOT NULL DEFAULT 80.00,
  hotel_diaria_padrao numeric(10,2) NOT NULL DEFAULT 250.00,
  -- Passagem aérea por km/pessoa: só entra quando NADA foi informado, e o motor
  -- marca a linha como estimativa grosseira para o diretor ver.
  aviao_por_km_pessoa numeric(10,4) NOT NULL DEFAULT 0.9000,

  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  PRIMARY KEY (company_id, year)
);

-- ── A viagem ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.orcamento_viagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  -- Setor que ORÇA a viagem. A maioria é Consultoria, mas qualquer setor pode.
  setor_id uuid REFERENCES public.orcamento_setores(id) ON DELETE SET NULL,
  -- Categoria da Omie onde a viagem cai na DRE. Explícita porque a empresa tem
  -- mais de uma categoria de viagem no plano (2.01.98 e 2.01.91 convivem).
  category_code text NOT NULL,

  titulo text NOT NULL,
  finalidade text,
  origem text NOT NULL,
  data_ida date,
  pessoas integer NOT NULL DEFAULT 1 CHECK (pessoas >= 1),
  -- 1 = cada um no seu quarto; 2 = dividindo. É campo, e não `pessoas/2`
  -- fixo, porque muda a hospedagem em até 2×.
  pessoas_por_quarto integer NOT NULL DEFAULT 2 CHECK (pessoas_por_quarto >= 1),

  -- Translado casa ↔ terminal (custo de UM trajeto, para o grupo todo).
  translado_custo_trajeto numeric(15,2),
  translado_trajetos integer,

  -- Trecho de VOLTA à origem (a ida de cada parada fica na própria parada).
  volta_modal text,
  volta_distancia_km numeric(10,2),
  volta_preco_pessoa numeric(15,2),
  volta_preco_total numeric(15,2),
  volta_pedagios numeric(15,2),
  volta_veiculos integer,

  -- Linhas avulsas: inscrição, seguro, bagagem. [{descricao, valor}]
  outros jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- ── O RETRATO do cálculo ─────────────────────────────────────────────────
  -- Gravado, não recalculado na leitura. Se o custo saísse da fórmula a cada
  -- consulta, o admin mudando a diária de hotel em novembro alteraria EM
  -- SILÊNCIO viagens que o diretor já aprovou — e o Budget já publicado. É a
  -- mesma razão pela qual o Plano de Cargos COPIA o salário em vez de apontar
  -- para ele.
  custo_total numeric(15,2) NOT NULL DEFAULT 0,
  -- 12 posições; o custo cai no mês da PARTIDA (ver o motor).
  meses jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Abertura por grupo, como o diretor a vê: [{grupo, label, linhas, total}]
  grupos jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- O que foi ARBITRADO por falta de dado. O diretor lê antes de aprovar.
  premissas jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Os parâmetros VIGENTES no momento do cálculo. Sem isto o retrato seria pela
  -- metade: dava para ver o número, não para reconstruí-lo.
  parametros jsonb,
  calculado_em timestamptz,

  -- `rascunho` não entra na Prévia nem na fila do diretor: ainda não é
  -- orçamento. `enviada` entra e vira item pendente de decisão. A aprovação em
  -- si é do diretor e mora em `orcamento_validacoes` (alvo_tipo 'viagem') —
  -- aqui só se registra que o SOLICITANTE deu por pronta.
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'enviada')),
  enviada_em timestamptz,
  enviada_por uuid REFERENCES public.users(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS orcamento_viagens_empresa_ano_idx
  ON public.orcamento_viagens (company_id, year);
CREATE INDEX IF NOT EXISTS orcamento_viagens_setor_idx
  ON public.orcamento_viagens (company_id, year, setor_id);

-- ── As paradas, na ordem do roteiro ─────────────────────────────────────────
-- Cada parada carrega o trecho de CHEGADA até ela. JF → Curitiba → Floripa → JF
-- são duas paradas (Curitiba e Floripa) + o trecho de volta, que fica na viagem.
-- Uma tabela só, uma lista ordenada só: duas listas paralelas sairiam de sincronia.
CREATE TABLE IF NOT EXISTS public.orcamento_viagem_paradas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viagem_id uuid NOT NULL REFERENCES public.orcamento_viagens(id) ON DELETE CASCADE,
  ordem integer NOT NULL,

  cidade text NOT NULL,
  noites integer NOT NULL DEFAULT 0 CHECK (noites >= 0),

  -- Trecho de chegada (da origem, se for a primeira parada).
  chegada_de text NOT NULL,
  chegada_modal text NOT NULL,
  chegada_distancia_km numeric(10,2),
  chegada_preco_pessoa numeric(15,2),
  chegada_preco_total numeric(15,2),
  chegada_pedagios numeric(15,2),
  chegada_veiculos integer,

  -- Diária do hotel escolhido. NULL = usa o parâmetro, e o motor avisa.
  diaria_hotel numeric(15,2),

  -- Deslocamento do dia a dia: hotel ↔ unidade Viva, hotel ↔ salão. É o custo
  -- que a escolha do hotel deveria minimizar, por isso é separado do translado.
  local_trajetos_dia integer,
  local_custo_trajeto numeric(15,2),
  local_destino text,
  -- Endereço confirmado pelo solicitante (a IA busca e propõe; ele confirma).
  local_endereco text,

  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (viagem_id, ordem)
);

CREATE INDEX IF NOT EXISTS orcamento_viagem_paradas_viagem_idx
  ON public.orcamento_viagem_paradas (viagem_id, ordem);

-- ── A conversa com a IA, por viagem ─────────────────────────────────────────
-- Mesmo enquadramento da entrevista do Planejamento: o transcript fica, porque
-- é nele que mora o raciocínio de quem orçou — e o diretor pode querer lê-lo.
CREATE TABLE IF NOT EXISTS public.orcamento_viagem_conversas (
  viagem_id uuid PRIMARY KEY REFERENCES public.orcamento_viagens(id) ON DELETE CASCADE,
  conversa jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── Endereços conhecidos: o cadastro que se preenche sozinho ────────────────
-- A IA PROPÕE o endereço (do que ela sabe — não há busca na web ligada); o
-- solicitante confirma, e é a confirmação que grava. A segunda viagem à mesma
-- cidade reusa em vez de perguntar de novo — o que resolve consistência, não só
-- conveniência: sem isto, duas viagens ao mesmo lugar poderiam ser orçadas
-- contra endereços diferentes e o custo de deslocamento divergiria sem ninguém
-- entender por quê.
CREATE TABLE IF NOT EXISTS public.orcamento_viagem_enderecos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cidade text NOT NULL,
  nome text NOT NULL,
  endereco text,
  -- 'unidade' (Viva Eventos da cidade) | 'salao' | 'outro'
  tipo text NOT NULL DEFAULT 'outro' CHECK (tipo IN ('unidade', 'salao', 'outro')),
  -- De onde veio o endereço, para distinguir confirmado de sugerido.
  fonte text,
  confirmado_em timestamptz,
  confirmado_por uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Nome único por empresa+cidade, sem depender de caixa/espaço.
CREATE UNIQUE INDEX IF NOT EXISTS orcamento_viagem_enderecos_chave_idx
  ON public.orcamento_viagem_enderecos (company_id, lower(btrim(cidade)), lower(btrim(nome)));

-- ── RLS: mesmo padrão das outras tabelas do módulo ──────────────────────────
-- Admin faz tudo; quem alcança a empresa no Orçamento LÊ. A escrita do
-- construtor passa pelo admin client depois do gate da action, como no resto
-- do módulo — o recorte por setor é regra de aplicação, não de policy.
DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY[
    'orcamento_viagem_parametros',
    'orcamento_viagens',
    'orcamento_viagem_enderecos'
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

-- Paradas e conversa não têm `company_id`: herdam o alcance da VIAGEM. Pôr a
-- coluna nelas só para a policy duplicaria o vínculo e abriria caminho para ele
-- divergir do da viagem numa atualização futura.
ALTER TABLE public.orcamento_viagem_paradas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orcamento_viagem_paradas admin all" ON public.orcamento_viagem_paradas;
CREATE POLICY "orcamento_viagem_paradas admin all" ON public.orcamento_viagem_paradas
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "orcamento_viagem_paradas orcamento read" ON public.orcamento_viagem_paradas;
CREATE POLICY "orcamento_viagem_paradas orcamento read" ON public.orcamento_viagem_paradas
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orcamento_viagens v
      WHERE v.id = viagem_id AND public.orcamento_pode_ler_empresa(v.company_id)
    )
  );

ALTER TABLE public.orcamento_viagem_conversas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orcamento_viagem_conversas admin all" ON public.orcamento_viagem_conversas;
CREATE POLICY "orcamento_viagem_conversas admin all" ON public.orcamento_viagem_conversas
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "orcamento_viagem_conversas orcamento read" ON public.orcamento_viagem_conversas;
CREATE POLICY "orcamento_viagem_conversas orcamento read" ON public.orcamento_viagem_conversas
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orcamento_viagens v
      WHERE v.id = viagem_id AND public.orcamento_pode_ler_empresa(v.company_id)
    )
  );

NOTIFY pgrst, 'reload schema';
