-- =============================================================================
-- HISTÓRICO DE VIAGENS REALIZADAS + REAJUSTE POR GRUPO DE CUSTO (02/10/2026).
--
-- ── O pedido, e por que ele está certo ────────────────────────────────────
-- O admin reclamou do desenho anterior com razão: preencher o valor de ~10 faixas
-- à mão é trabalho que ele não tem como fazer bem, porque ele não TEM esses
-- números na cabeça — ele tem a planilha do que foi gasto em 2026. E vários
-- destinos se repetem.
--
-- Então a fonte de preço passa a ser o que aconteceu: ele sobe o histórico e
-- digita ~4 percentuais de reajuste (um por grupo de custo). O que não tiver
-- histórico continua caindo na faixa — que agora também pode ser PREENCHIDA a
-- partir do histórico — e, em último caso, na busca na web.
--
-- ── Por que o histórico ganha da busca na web ────────────────────────────
-- A busca devolve preço de MERCADO para uma rota. O histórico devolve o que ESTE
-- time pagou para ir ALI, já com os hábitos que nenhuma busca saberia (o dia em
-- que costumam voar, o hotel que usam, quando vão de carro). Para destino que
-- repete, "ano passado + reajuste" é como orçamento se faz — e é auditável: a
-- premissa do motor diz "histórico de Recife em 2026 (mediana de 2 viagens,
-- mai/set, +8%)".
--
-- ── Uma linha por VIAGEM, não por destino ───────────────────────────────
-- Custo só se reusa em UNIDADE: uma viagem de 4 pessoas / 3 noites não estima uma
-- de 2 pessoas / 1 noite a partir do total. Por isso a linha guarda pessoas,
-- noites e ocupação junto do que foi pago, e o custo unitário é DERIVADO na
-- leitura (`src/lib/viagens/historico.ts`), nunca gravado:
--
--   passagem   → R$ por pessoa, SÓ IDA   (÷ pessoas ÷ 2 trechos)
--   hospedagem → R$ por quarto por noite (÷ noites ÷ quartos)
--   alimentação→ R$ por pessoa por dia   (÷ pessoas ÷ (noites + 1))
--
-- Derivar na leitura é o que deixa trocar o reajuste sem reimportar nada, e o que
-- permite corrigir a regra de normalização sem mexer no dado. O histórico é FATO;
-- o reajuste é PREMISSA. Ficam em tabelas separadas por isso.
--
-- ── O reajuste é por GRUPO DE CUSTO, não um índice único ────────────────
-- Tarifa aérea e diária de hotel não sobem no mesmo ritmo. São ~4 números em vez
-- de ~50, que era a reclamação, e cada um descreve uma realidade diferente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.orcamento_viagem_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Ano em que a viagem ACONTECEU (o ano-base), não o ano do orçamento.
  year integer NOT NULL,

  cidade text NOT NULL,
  -- Mês da viagem. Entra na premissa porque tarifa é sazonal — e o sistema NÃO
  -- modela sazonalidade (uma ou duas observações por destino não sustentam isso):
  -- ele mostra o mês observado para quem valida ver que está orçando julho com
  -- base em janeiro.
  mes smallint CHECK (mes IS NULL OR (mes BETWEEN 1 AND 12)),

  -- Sem pessoas não há custo unitário, e assumir 1 numa viagem de 4 multiplicaria
  -- a referência por quatro, calado. Por isso NOT NULL com CHECK.
  pessoas smallint NOT NULL CHECK (pessoas >= 1),
  noites smallint NOT NULL DEFAULT 0 CHECK (noites >= 0),
  -- 1 = cada um no seu quarto. NULL = não informado (a leitura assume 2, a
  -- convenção do módulo). Muda a hospedagem em até 2×.
  pessoas_por_quarto smallint CHECK (pessoas_por_quarto IS NULL OR pessoas_por_quarto >= 1),
  -- Carro e van NÃO alimentam referência de passagem: ali o custo é km × R$/km, e
  -- deixar entrar faria o dia em que alguém for de avião ao mesmo destino sair com
  -- o custo do carro. A HOSPEDAGEM dessas viagens conta normalmente.
  modal text,

  -- O que foi PAGO na viagem, por grupo: total do grupo todo, as duas pernas.
  -- NULL = não informado, que é diferente de zero (de graça).
  custo_passagem numeric(15,2),
  custo_hospedagem numeric(15,2),
  custo_alimentacao numeric(15,2),

  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

-- A busca é sempre (empresa, ano) e o agrupamento é por cidade normalizada —
-- índice por expressão aqui é só para LER, nunca chave única: duas viagens ao
-- mesmo destino no mesmo mês são dois fatos distintos, e deduplicar apagaria uma
-- observação legítima da mediana.
CREATE INDEX IF NOT EXISTS orcamento_viagem_historico_empresa_idx
  ON public.orcamento_viagem_historico (company_id, year);

CREATE INDEX IF NOT EXISTS orcamento_viagem_historico_cidade_idx
  ON public.orcamento_viagem_historico (company_id, year, lower(btrim(cidade)));

-- ── O reajuste, por grupo de custo ─────────────────────────────────────────
-- Uma linha por grupo, não seis colunas: grupo novo no motor entra sem migration
-- de coluna. A chave é em colunas comuns (sem expressão), então `upsert` com
-- `onConflict` funciona aqui — ao contrário de `orcamento_grupo_escopo`.
CREATE TABLE IF NOT EXISTS public.orcamento_viagem_reajuste (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Ano do ORÇAMENTO (o de destino). O percentual é "do histórico até este ano",
  -- acumulado: com histórico de 2025 orçando 2027, o admin digita o acumulado.
  -- Compor ano a ano exigiria uma linha por ano intermediário para ganhar
  -- precisão que ninguém tem.
  year integer NOT NULL,
  grupo text NOT NULL CHECK (
    grupo IN ('passagem', 'translado', 'transporte_local', 'hospedagem', 'alimentacao', 'outros')
  ),
  -- Percentual: 8 = +8%. Negativo é permitido (deflação de tarifa acontece).
  percentual numeric(8,3) NOT NULL DEFAULT 0,

  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,

  UNIQUE (company_id, year, grupo)
);

-- ── O ano-base do histórico que a empresa usa ─────────────────────────────
-- Fica em `orcamento_viagem_parametros` (que já é por empresa × ano) em vez de
-- uma tabela nova: é um número por exercício, do mesmo naipe dos outros
-- parâmetros. NULL = use o ano mais recente que existir no histórico.
ALTER TABLE public.orcamento_viagem_parametros
  ADD COLUMN IF NOT EXISTS historico_ano_base integer;

-- ── RLS: o padrão do módulo ────────────────────────────────────────────────
-- Admin escreve; quem alcança a empresa no Orçamento LÊ. A leitura tem de ser
-- aberta porque é o motor do custo de CADA linha da grade: um gestor que não
-- pudesse ler o histórico veria a viagem cair na faixa (ou em zero) sem entender
-- por quê.
ALTER TABLE public.orcamento_viagem_historico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orcamento_viagem_historico admin all" ON public.orcamento_viagem_historico;
CREATE POLICY "orcamento_viagem_historico admin all" ON public.orcamento_viagem_historico
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "orcamento_viagem_historico orcamento read" ON public.orcamento_viagem_historico;
CREATE POLICY "orcamento_viagem_historico orcamento read" ON public.orcamento_viagem_historico
  FOR SELECT TO authenticated
  USING (public.orcamento_pode_ler_empresa(company_id));

ALTER TABLE public.orcamento_viagem_reajuste ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orcamento_viagem_reajuste admin all" ON public.orcamento_viagem_reajuste;
CREATE POLICY "orcamento_viagem_reajuste admin all" ON public.orcamento_viagem_reajuste
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "orcamento_viagem_reajuste orcamento read" ON public.orcamento_viagem_reajuste;
CREATE POLICY "orcamento_viagem_reajuste orcamento read" ON public.orcamento_viagem_reajuste
  FOR SELECT TO authenticated
  USING (public.orcamento_pode_ler_empresa(company_id));

NOTIFY pgrst, 'reload schema';
