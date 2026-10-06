-- =============================================================================
-- VIAGENS: o FLUXO substitui a estimativa (06/10/2026).
--
-- ── O pedido ──────────────────────────────────────────────────────────────
-- "Vamos fazer de uma forma mais simples, pois está ficando muito pesado e
-- complicado." O sistema deixa de tentar PRECIFICAR a viagem (parâmetros, faixas
-- por região, histórico, busca na web — cada camada resolvendo um pedaço e somando
-- complexidade) e passa a fazer o que software faz bem: garantir que cada viagem
-- esteja na mão de UMA pessoa a cada momento, e que o repasse não se perca.
--
-- A cotação é feita FORA, pela Controladoria, com IA no cowork — onde isso é
-- rápido. Os valores entram aqui por grupo de despesa, digitados ou por planilha.
--
-- ── Cinco estados, UMA coluna ────────────────────────────────────────────
--   rascunho            gestor preenche
--   aguardando_cotacao  o OK do gestor (amarelo claro na tela); ele pode voltar
--   em_cotacao          o admin FECHOU; só ele mexe, e é isto que sai no .xls
--   cotada              valores por grupo lançados (derivado do valor, não botão)
--   em_aprovacao        seguiu para a diretoria; é só aqui que o ✓/✗/💬 aparece
--
-- Uma coluna, não quatro booleanos: com booleanos existem combinações impossíveis
-- (travado sem ok, cotado sem travar) e a tela passa a mostrar estado que o fluxo
-- não produz.
--
-- ── O CHECK é o ponto que já quebrou cinco vezes neste módulo ────────────
-- `orcamento_viagens.status` era `CHECK IN ('rascunho','enviada')`. Valor novo
-- inventado no código sem mexer no CHECK falha com 23514 — e em alguns caminhos
-- (a trilha) falhava EM SILÊNCIO. Por isso o CHECK é recriado aqui, junto com a
-- conversão das linhas existentes.
--
-- ── A decisão da diretoria NÃO entra neste status ────────────────────────
-- Continua em `orcamento_validacoes` (pendente/aprovado/reprovado/revisar),
-- compartilhada com Pessoal, Média, Valor fixo e Planejamento. Duplicá-la aqui
-- faria a mesma informação existir em dois lugares, e um dia divergem. O `revisar`
-- já é o único estado em que o gestor edita item decidido — é exatamente o passo 5
-- do fluxo, e não precisou de código novo.
--
-- ── O que SAI do caminho (tabelas ficam, sem leitor) ─────────────────────
-- `orcamento_viagem_faixas`, `orcamento_viagem_historico`,
-- `orcamento_viagem_reajuste`, `orcamento_viagem_referencia` e
-- `orcamento_viagem_parametros` deixam de ser lidas: o custo é a soma dos grupos
-- cotados. Ficam no banco pela convenção do módulo (reversível, e o histórico de
-- 2026 já convertido continua lá se alguém quiser retomá-lo). **Não as traga de
-- volta ao cálculo** — foi a complexidade que este desenho veio desfazer.
-- =============================================================================

-- ── 1. O estado ────────────────────────────────────────────────────────────
ALTER TABLE public.orcamento_viagens
  DROP CONSTRAINT IF EXISTS orcamento_viagens_status_check;

-- Converte ANTES de recriar o CHECK, senão o próprio ALTER falha nas linhas
-- antigas. `enviada` era "o gestor terminou" e cai em `aguardando_cotacao`: é o
-- equivalente mais próximo e não inventa cotação que não existe.
UPDATE public.orcamento_viagens
   SET status = 'aguardando_cotacao'
 WHERE status = 'enviada';

ALTER TABLE public.orcamento_viagens
  ADD CONSTRAINT orcamento_viagens_status_check
  CHECK (status IN ('rascunho', 'aguardando_cotacao', 'em_cotacao', 'cotada', 'em_aprovacao'));

-- ── 2. Os valores da cotação, por grupo ────────────────────────────────────
-- Seis colunas e não uma tabela filha: o vocabulário de grupos é FECHADO (os
-- mesmos do motor, que é por onde a linha abre em árvore para o diretor e por onde
-- a Prévia já soma). Uma tabela viagem × grupo daria flexibilidade que ninguém
-- pediu e um JOIN em toda leitura da grade.
--
-- NULL = não cotado, que é diferente de zero (= cotado e não há esse custo).
-- Conflar os dois faria "não sei" e "de graça" virarem a mesma coisa no total.
ALTER TABLE public.orcamento_viagens
  ADD COLUMN IF NOT EXISTS cot_passagem numeric(15,2) CHECK (cot_passagem IS NULL OR cot_passagem >= 0),
  ADD COLUMN IF NOT EXISTS cot_translado numeric(15,2) CHECK (cot_translado IS NULL OR cot_translado >= 0),
  ADD COLUMN IF NOT EXISTS cot_transporte_local numeric(15,2) CHECK (cot_transporte_local IS NULL OR cot_transporte_local >= 0),
  ADD COLUMN IF NOT EXISTS cot_hospedagem numeric(15,2) CHECK (cot_hospedagem IS NULL OR cot_hospedagem >= 0),
  ADD COLUMN IF NOT EXISTS cot_alimentacao numeric(15,2) CHECK (cot_alimentacao IS NULL OR cot_alimentacao >= 0),
  ADD COLUMN IF NOT EXISTS cot_outros numeric(15,2) CHECK (cot_outros IS NULL OR cot_outros >= 0);

-- Quando e para que DIA a cotação foi feita, e de onde veio.
--
-- O gestor dá o MÊS; a cotação é de um dia concreto. Guardar esse dia é o que
-- permite reconstruir o número depois ("cotado para 12/03, tarifa de terça") — sem
-- ele, seis meses adiante ninguém sabe se o valor era de alta ou baixa estação.
ALTER TABLE public.orcamento_viagens
  ADD COLUMN IF NOT EXISTS cotado_em timestamptz,
  ADD COLUMN IF NOT EXISTS cotado_por uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cotacao_data_base date,
  ADD COLUMN IF NOT EXISTS cotacao_observacao text;

-- ── 3. "O roteiro mudou depois da cotação" ─────────────────────────────────
-- Precisa de coluna PRÓPRIA: `updated_at` se move também quando o admin digita um
-- valor, então compará-lo com `cotado_em` acusaria alteração em toda cotação. Esta
-- só é tocada quando os DADOS BÁSICOS mudam (destino, mês, noites, pessoas…) — é o
-- que permite a linha avisar que a cotação ficou obsoleta sem apagar os valores.
ALTER TABLE public.orcamento_viagens
  ADD COLUMN IF NOT EXISTS basico_alterado_em timestamptz;

-- ── 4. UF do destino ───────────────────────────────────────────────────────
-- Mora na PARADA, junto da cidade. "São Paulo" e "São Paulo do Potengi" cotam
-- muito diferente, e dois caracteres evitam uma cotação para a cidade errada.
ALTER TABLE public.orcamento_viagem_paradas
  ADD COLUMN IF NOT EXISTS uf text CHECK (uf IS NULL OR char_length(uf) = 2);

-- A grade lista por estado e o admin filtra por ele — e a consulta é sempre
-- (empresa, ano).
CREATE INDEX IF NOT EXISTS orcamento_viagens_estado_idx
  ON public.orcamento_viagens (company_id, year, status);

NOTIFY pgrst, 'reload schema';
