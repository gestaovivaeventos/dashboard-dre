-- =============================================================================
-- Módulo Orçamento — FINALIZAÇÃO por tela × setor, com TRAVA.
--
-- A "entrega de setor" era um aviso sem efeito: o gestor marcava "terminei" e
-- continuava podendo editar. Pedido do dono do projeto (27/09/2026): o botão
-- tem de FECHAR o orçamento daquele setor para edição, e só um administrador
-- reabre.
--
-- Duas mudanças na mesma tabela:
--
--   1. granularidade: de (ciclo, rodada, setor) para (ciclo, rodada, MÉTODO,
--      setor). O gestor termina o Pessoal do Atendimento sem ter terminado o
--      Planejamento do mesmo setor — e a validação da diretoria já funciona
--      nessa mesma unidade, então as duas pontas passam a falar a mesma língua.
--   2. `setor_chave` textual, porque o setor pode ser nulo (empresa que não
--      orça por setor) e NULL não entra em PRIMARY KEY.
--
-- As linhas que já existem são do modelo antigo (setor inteiro, sem método).
-- Elas viram `metodo = '-'` e o código NÃO as trata como trava: converter um
-- aviso em bloqueio faria o gestor perder a edição de um dia para o outro, sem
-- ele ter pedido nada. Ficam como histórico.
--
-- ── ORDEM IMPORTA ──────────────────────────────────────────────────────────
-- `setor_id` participa da PK atual, e o Postgres recusa remover o NOT NULL de
-- uma coluna que está numa primary key (42P16). Por isso a sequência é:
-- derrubar a PK antiga PRIMEIRO, depois soltar o NOT NULL, e só então criar a
-- PK nova. (A primeira versão deste arquivo fazia na ordem errada e falhou.)
--
-- Idempotente: pode rodar de novo depois de uma execução parcial.
-- =============================================================================

-- 1) Colunas novas.
ALTER TABLE public.orcamento_setor_entregas
  ADD COLUMN IF NOT EXISTS metodo text NOT NULL DEFAULT '-',
  ADD COLUMN IF NOT EXISTS setor_chave text,
  ADD COLUMN IF NOT EXISTS reaberto_em timestamptz,
  ADD COLUMN IF NOT EXISTS reaberto_por uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- 2) Preenche a chave textual antes de torná-la obrigatória.
UPDATE public.orcamento_setor_entregas
SET setor_chave = COALESCE(setor_id::text, '-')
WHERE setor_chave IS NULL;

ALTER TABLE public.orcamento_setor_entregas
  ALTER COLUMN setor_chave SET NOT NULL;

-- 3) Derruba a PK antiga — tem de vir ANTES de soltar o NOT NULL de setor_id.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.orcamento_setor_entregas'::regclass AND contype = 'p'
  LOOP
    EXECUTE format('ALTER TABLE public.orcamento_setor_entregas DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- 4) Agora sim: o setor pode ser nulo (empresa sem orçamento por setor); quem
--    identifica a linha é `setor_chave`.
ALTER TABLE public.orcamento_setor_entregas
  ALTER COLUMN setor_id DROP NOT NULL;

-- 5) Chave nova: uma finalização por (ciclo, rodada, método, setor).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.orcamento_setor_entregas'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE public.orcamento_setor_entregas
      ADD CONSTRAINT orcamento_setor_entregas_pkey
      PRIMARY KEY (ciclo_id, rodada, metodo, setor_chave);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS orcamento_setor_entregas_metodo_idx
  ON public.orcamento_setor_entregas (ciclo_id, rodada, metodo);

NOTIFY pgrst, 'reload schema';
