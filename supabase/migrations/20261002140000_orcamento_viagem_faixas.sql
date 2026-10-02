-- =============================================================================
-- FAIXAS de custo de viagem: a tabela de referência que substitui 50 cotações
-- (02/10/2026).
--
-- ── O problema que ela resolve ────────────────────────────────────────────
-- Um gestor de Consultoria orça ~50 viagens por ano, e os destinos quase não se
-- repetem (1 ou 2, no máximo duas vezes). Cotar por viagem não amortiza nada — e
-- nem é preciso: o orçamento tem só o MÊS, um ano à frente, quando a tarifa ainda
-- não foi publicada. Era um instrumento de precisão para um problema que precisa
-- de um estimador rápido e CONSISTENTE.
--
-- Então o número vem de ~10 linhas que o admin cura uma vez por ano, e é só aqui
-- que a busca na web e a IA trabalham. Ganho colateral que importa: duas viagens
-- ao mesmo destino passam a custar o mesmo — antes saíam diferentes só porque a
-- busca correu em dias diferentes.
--
-- ── Uma tabela, dois tipos ───────────────────────────────────────────────
-- `tipo = 'passagem'`   → faixa por distância/região, valor POR PESSOA (só ida).
-- `tipo = 'hospedagem'` → tipo de praça (capital/interior/turístico), diária POR
--                         QUARTO.
--
-- Duas tabelas separadas seriam mais "puras" e dariam duas telas de cadastro para
-- manter em sincronia, para ~10 linhas no total. O `tipo` mantém uma tela só, com
-- duas seções.
--
-- ── Por que NÃO há cadastro cidade → faixa ──────────────────────────────
-- Com ~50 destinos usados uma vez cada, um de-para de cidades seria cadastro que
-- ninguém reusa — e que alguém teria de alimentar a cada destino novo. A faixa vai
-- como COLUNA na linha da viagem, sugerida pela IA no intake e conferida pelo
-- gestor. Se a repetição crescer, o de-para entra depois sem refazer nada.
--
-- ── Isto NÃO é o retorno do R$/km de avião ──────────────────────────────
-- O que foi removido em 01/10/2026 era um valor por quilômetro, que não distingue
-- janeiro de julho nem rota concorrida de rota sem concorrência. A faixa é o
-- oposto: um valor CURADO por região, revisado por quem responde pelo número, e a
-- premissa do motor diz de qual faixa veio. O invariante continua de pé — o número
-- do orçamento vem de parâmetro explicável, nunca de um palpite do modelo no
-- momento de orçar.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.orcamento_viagem_faixas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year integer NOT NULL,

  tipo text NOT NULL CHECK (tipo IN ('passagem', 'hospedagem')),
  -- "Capital Sul/Sudeste", "Nordeste", "até 300 km (carro)", "Interior".
  nome text NOT NULL,
  -- Passagem: R$ por pessoa, SÓ IDA (o motor cobra o trecho de volta à parte).
  -- Hospedagem: R$ por quarto por noite.
  valor numeric(15,2) NOT NULL DEFAULT 0,
  -- Só para 'passagem': o modal que esta faixa pressupõe. Em `carro`/`van` o motor
  -- IGNORA o valor e calcula por km × R$/km — ali a distância é o driver real, e é
  -- um número que a empresa tem.
  modal text,
  -- Ordem de exibição. A ordem alfabética embaralharia "até 300 km" com "Norte".
  ordem integer NOT NULL DEFAULT 0,

  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

-- Nome único por empresa × ano × tipo, sem depender de caixa/espaço — a mesma
-- normalização dos grupos de despesa e dos tipos de viagem.
CREATE UNIQUE INDEX IF NOT EXISTS orcamento_viagem_faixas_nome_idx
  ON public.orcamento_viagem_faixas (company_id, year, tipo, lower(btrim(nome)));

CREATE INDEX IF NOT EXISTS orcamento_viagem_faixas_empresa_idx
  ON public.orcamento_viagem_faixas (company_id, year, tipo, ordem);

-- ── A viagem aponta para as duas faixas ────────────────────────────────────
-- `ON DELETE SET NULL`: apagar uma faixa não apaga viagem. A viagem conserva o
-- RETRATO do custo (ela já guarda `grupos`/`meses`/`parametros`), então o número
-- não muda; o que se perde é a etiqueta de onde ele veio — e a tela diz isso em
-- vez de recalcular por baixo.
ALTER TABLE public.orcamento_viagens
  ADD COLUMN IF NOT EXISTS faixa_passagem_id uuid
    REFERENCES public.orcamento_viagem_faixas(id) ON DELETE SET NULL;

ALTER TABLE public.orcamento_viagens
  ADD COLUMN IF NOT EXISTS faixa_hospedagem_id uuid
    REFERENCES public.orcamento_viagem_faixas(id) ON DELETE SET NULL;

-- ── RLS: mesmo padrão do resto do módulo ───────────────────────────────────
-- Admin faz tudo; quem alcança a empresa no Orçamento LÊ (a grade precisa das
-- faixas para mostrar o custo, e um gestor que não pudesse lê-las veria zero).
ALTER TABLE public.orcamento_viagem_faixas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orcamento_viagem_faixas admin all" ON public.orcamento_viagem_faixas;
CREATE POLICY "orcamento_viagem_faixas admin all" ON public.orcamento_viagem_faixas
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "orcamento_viagem_faixas orcamento read" ON public.orcamento_viagem_faixas;
CREATE POLICY "orcamento_viagem_faixas orcamento read" ON public.orcamento_viagem_faixas
  FOR SELECT TO authenticated
  USING (public.orcamento_pode_ler_empresa(company_id));

NOTIFY pgrst, 'reload schema';
