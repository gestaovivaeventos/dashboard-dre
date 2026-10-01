-- =============================================================================
-- Viagens: destrava os CHECK que barram o método novo (01/10/2026).
--
-- O método `viagens` foi fiado no código (migration 20261001120000), mas QUATRO
-- constraints no banco enumeram o vocabulário de métodos e de alvos, e nenhuma
-- conhecia o novo. Conferido contra produção antes desta migration, com INSERT
-- de sonda: as duas primeiras devolvem 23514.
--
-- O efeito de cada uma, se ficassem como estavam:
--
--   1. `orcamento_categoria_metodo.metodo` — o admin NÃO CONSEGUE marcar uma
--      categoria como orçada por Viagens. É a primeira porta: sem isso a tela
--      diz "nenhuma categoria está sendo orçada por Viagens" para sempre.
--   2. `orcamento_finalizacoes_metodo_check` — o botão Finalizar da fatia de
--      viagens dá erro 23514.
--   3. `orcamento_validacoes_alvo_tipo_chk` — o ✓ do diretor numa viagem dá
--      erro 23514.
--   4. `orcamento_alteracoes_alvo_tipo_chk` — a trilha NÃO registra nada de
--      viagem, **em silêncio**: `registrarAlteracao` só escreve no console, de
--      propósito (a trilha nunca derruba a ação que ela registra). Era a mais
--      perigosa das quatro, porque ninguém ia perceber.
--
-- ── Consequência de desenho que vale registrar ────────────────────────────
-- Enquanto esses CHECK enumerarem as chaves, **todo método novo do Orçamento
-- exige uma migration como esta**, e esquecê-la quebra em quatro lugares, um
-- deles calado. A alternativa seria tirar os CHECK e deixar o vocabulário só no
-- código — foi decidido MANTER: eles pegam erro de digitação numa coluna `text`
-- que entra em chave única, e esse erro produz linha órfã que nenhuma tela lê.
-- O preço é esta migration; o registro dela está no CLAUDE.md.
-- =============================================================================

-- ── 1. O método por categoria ───────────────────────────────────────────────
-- `viagens_ve` SAI: era placeholder de um método específico de Viva Eventos que
-- nunca teve tela, com ZERO linhas em produção (conferido). Deixá-lo valendo
-- permitiria marcar uma categoria com um método que o código não conhece mais —
-- e a categoria ficaria sem caminho de preenchimento, sem erro em lugar nenhum.
ALTER TABLE public.orcamento_categoria_metodo
  DROP CONSTRAINT IF EXISTS orcamento_categoria_metodo_metodo_check;

ALTER TABLE public.orcamento_categoria_metodo
  ADD CONSTRAINT orcamento_categoria_metodo_metodo_check
  CHECK (
    metodo IN (
      'pessoal',
      'media',
      'valor_fixo',
      'planejamento_socios',
      'viagens',
      -- Seguem sem tela: marcar uma categoria com um destes a deixa sem caminho
      -- de preenchimento. Ficam porque o desenho os prevê (ver METODOS em
      -- metodos.ts, campo `ve`).
      'marketing_ve',
      'endomarketing_ve'
    )
  );

-- ── 2. A fatia finalizada ───────────────────────────────────────────────────
ALTER TABLE public.orcamento_finalizacoes
  DROP CONSTRAINT IF EXISTS orcamento_finalizacoes_metodo_check;

ALTER TABLE public.orcamento_finalizacoes
  ADD CONSTRAINT orcamento_finalizacoes_metodo_check
  CHECK (metodo IN ('pessoal', 'media', 'valor_fixo', 'planejamento_socios', 'viagens'));

-- ── 3. O alvo da decisão da diretoria ───────────────────────────────────────
-- 'viagem' é a VIAGEM INTEIRA, não cada custo dela: o diretor aprova ou reprova
-- a ida olhando a abertura por grupo, e não faria sentido aprovar a passagem e
-- reprovar o hotel da mesma viagem. Mesmo enquadramento de 'colaborador'.
ALTER TABLE public.orcamento_validacoes
  DROP CONSTRAINT IF EXISTS orcamento_validacoes_alvo_tipo_chk;

ALTER TABLE public.orcamento_validacoes
  ADD CONSTRAINT orcamento_validacoes_alvo_tipo_chk
  CHECK (
    alvo_tipo IN (
      'colaborador',
      'media_linha',
      'valor_fixo_contrato',
      'planejamento_item',
      'viagem'
    )
  );

-- ── 4. O alvo da trilha ─────────────────────────────────────────────────────
-- As AÇÕES usadas pelas actions de viagem (criou, alterou, excluiu, solicitou,
-- reabriu) já estavam todas no `_acao_chk`; só o alvo faltava.
ALTER TABLE public.orcamento_alteracoes
  DROP CONSTRAINT IF EXISTS orcamento_alteracoes_alvo_tipo_chk;

ALTER TABLE public.orcamento_alteracoes
  ADD CONSTRAINT orcamento_alteracoes_alvo_tipo_chk
  CHECK (
    alvo_tipo IN (
      'colaborador',
      'planejamento_item',
      'valor_fixo_contrato',
      'media_linha',
      'categoria_setor',
      'viagem',
      'ciclo',
      -- A fatia finalizada: `alvoId` é a `source` determinística da publicação.
      -- Entrou com o Finalizar (30/09/2026) e NÃO estava neste CHECK — pelo
      -- mesmo motivo de 'viagem', e com o mesmo silêncio.
      'finalizacao'
    )
  );

-- ── 5. `orcamento_alteracoes.alvo_id` passa a ser TEXT ──────────────────────
-- Defeito do Finalizar (30/09/2026), descoberto ao conferir o item 4 contra
-- produção: a coluna é `uuid`, mas a finalização grava nela a `source` da fatia
-- (`orc:<metodo>:<categoria>:<setor>`), que não é uuid. A trilha da finalização
-- falhava com 22P02 ANTES de chegar ao CHECK — duas falhas independentes na
-- mesma chamada, as duas caladas (`registrarAlteracao` só escreve no console, de
-- propósito: a trilha nunca derruba a ação que ela registra).
--
-- Ninguém perdeu histórico: não há nenhuma finalização em produção ainda
-- (conferido). TEXT é também o que `orcamento_validacoes.alvo_id` já é, e pela
-- mesma razão — alvo do orçamento não é sempre uuid (a média é chaveada por
-- categoria + setor). O cast uuid→text é seguro e o índice se refaz sozinho.
ALTER TABLE public.orcamento_alteracoes
  ALTER COLUMN alvo_id TYPE text USING alvo_id::text;

NOTIFY pgrst, 'reload schema';
