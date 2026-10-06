-- =============================================================================
-- REFERÊNCIA DE DESTINO informada pela Controladoria (02/10/2026).
--
-- ── A regra que esta tabela serve ─────────────────────────────────────────
-- Decisão do dono do projeto: viagem a destino que não está no histórico **não é
-- bloqueada** — ela é cadastrada normalmente e fica com uma PENDÊNCIA nomeada
-- ("este destino não tem dados; avise a Controladoria"). A Controladoria informa
-- os valores depois, aqui, e o número da viagem passa a existir.
--
-- ── Por que isto NÃO é o histórico ───────────────────────────────────────
-- `orcamento_viagem_historico` guarda FATO: o que foi pago numa viagem que
-- aconteceu, com pessoas e noites, e o unitário é derivado. Aqui é PREMISSA: duas
-- unidades digitadas por quem responde pelo número, para um destino onde ninguém
-- foi ainda. Misturar os dois faria o relatório do histórico mentir sobre quantas
-- viagens observadas existem — e é a contagem de observações que diz o quanto
-- confiar na mediana.
--
-- ── O REAJUSTE não se aplica aqui ────────────────────────────────────────
-- O percentual por grupo de custo corrige um número de 2026 para 2027. Este já é
-- um número do ano do orçamento, digitado agora. Reajustá-lo o inflaria duas vezes.
-- Por isso a tabela é por empresa × ANO DO ORÇAMENTO: em 2028 a Controladoria
-- confirma de novo, em vez de herdar um valor de dois anos atrás sem perceber.
--
-- ── E a FAIXA por região? Saiu do caminho do cálculo ─────────────────────
-- Ela existia como plano B regional ("Capital Nordeste"), e era justamente isso que
-- impedia o aviso: a viagem saía com um valor plausível e ninguém era avisado de que
-- faltava dado. As tabelas `orcamento_viagem_faixas` e as colunas
-- `faixa_passagem_id` / `faixa_hospedagem_id` continuam no banco, sem leitor
-- (convenção do módulo para o que sai de uso) — não as recrie no cálculo.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.orcamento_viagem_referencia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Ano do ORÇAMENTO (o de destino), não o ano-base do histórico.
  year integer NOT NULL,

  cidade text NOT NULL,

  -- As duas unidades do motor, digitadas direto — sem pessoas nem noites, porque
  -- aqui não há viagem de onde derivar.
  --   passagem: R$ por pessoa, SÓ IDA (o motor cobra a volta como 2º trecho)
  --   diária:   R$ por quarto por noite
  -- NULL = a Controladoria ainda não informou ESSA metade. É estado legítimo: dá
  -- para saber a diária de uma cidade e não a passagem, e a pendência da viagem
  -- continua apontando só o que falta.
  passagem_por_pessoa numeric(15,2) CHECK (passagem_por_pessoa IS NULL OR passagem_por_pessoa >= 0),
  diaria_por_quarto numeric(15,2) CHECK (diaria_por_quarto IS NULL OR diaria_por_quarto >= 0),

  -- Modal que a passagem pressupõe (avião, ônibus). Em carro/van o custo é
  -- km × R$/km e esta linha não é consultada.
  modal text,
  -- De onde veio o número: cotação de agência, site, telefone. É o que permite
  -- alguém conferir depois, e vai para a premissa da viagem.
  observacao text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

-- Um destino por empresa × ano, sem depender de caixa/acento na digitação — a
-- mesma normalização do histórico e dos grupos de despesa. Índice por EXPRESSÃO,
-- então a gravação é INSERT/UPDATE explícito: `upsert({ignoreDuplicates})` não
-- funciona sobre expressão (a pegadinha de `orcamento_grupo_escopo`).
CREATE UNIQUE INDEX IF NOT EXISTS orcamento_viagem_referencia_cidade_idx
  ON public.orcamento_viagem_referencia (company_id, year, lower(btrim(cidade)));

ALTER TABLE public.orcamento_viagem_referencia ENABLE ROW LEVEL SECURITY;

-- Admin escreve; quem alcança a empresa no Orçamento LÊ. A leitura tem de ser
-- aberta porque é o custo de uma linha da grade: um gestor que não pudesse ler
-- veria a viagem em zero sem entender por quê — o oposto do que a pendência quer.
DROP POLICY IF EXISTS "orcamento_viagem_referencia admin all" ON public.orcamento_viagem_referencia;
CREATE POLICY "orcamento_viagem_referencia admin all" ON public.orcamento_viagem_referencia
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "orcamento_viagem_referencia orcamento read" ON public.orcamento_viagem_referencia;
CREATE POLICY "orcamento_viagem_referencia orcamento read" ON public.orcamento_viagem_referencia
  FOR SELECT TO authenticated
  USING (public.orcamento_pode_ler_empresa(company_id));

NOTIFY pgrst, 'reload schema';
