-- =============================================================================
-- Quais TELAS do orçamento aparecem em cada empresa (01/10/2026).
--
-- Pedido: "não quero que essa parte de viagens apareça em todas as empresas".
-- Nem toda unidade orça viagem, nem toda unidade tem quadro de pessoal próprio;
-- oferecer as sete caixas em todas polui o hub e convida a preencher o que não
-- se aplica.
--
-- ── Guarda-se o que está OCULTO, nunca o que está visível ──────────────────
-- A tabela é uma lista de EXCLUSÕES, e a escolha não é de gosto:
--
--   • tabela vazia = comportamento idêntico ao de antes, em todas as empresas.
--     Não há migração de dados, não há empresa que "nasce sem telas" porque
--     alguém esqueceu de cadastrá-la. É o mesmo enquadramento de
--     `company_excluded_projects`, e pelo mesmo motivo;
--   • método NOVO aparece por padrão, em vez de nascer escondido em todas as
--     empresas até alguém marcá-lo uma por uma. É a mesma razão pela qual a
--     Prévia guarda as linhas FECHADAS e não as abertas (`linhasVisiveis`):
--     conta nova tem de aparecer, não sumir.
--
-- A TELA mostra caixas de seleção do que aparece — desmarcar grava aqui. A
-- semântica da interface é "o que aparece"; a do armazenamento é "o que não
-- aparece". São coisas diferentes de propósito.
--
-- ── Por EMPRESA, sem ano ──────────────────────────────────────────────────
-- "Esta empresa orça viagem?" é fato cadastral da unidade, não do exercício.
-- Pôr ano aqui obrigaria a remarcar tudo a cada janeiro — e foi exatamente o
-- argumento que fez a atribuição de setor do orçamento guardar o NOME em vez do
-- id (que é por ano).
--
-- ── Isto esconde a PORTA, não o número ────────────────────────────────────
-- Esconder um método que já tem coisa orçada deixaria o valor somando na Prévia
-- e no Budget sem nenhuma tela por onde abri-lo — o pior resultado possível
-- aqui. Por isso a action RECUSA ocultar um método com dado naquela empresa, e
-- diz quanto/quantos existem. A trava é de aplicação, não de banco: o banco não
-- tem como contar quatro métodos num CHECK.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.orcamento_metodos_ocultos (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Chave do método (ver METODOS em src/lib/orcamento/metodos.ts). Sem CHECK de
  -- propósito: aqui a lista é de EXCLUSÕES, então uma chave que o código não
  -- conhece mais simplesmente não esconde nada — não produz linha órfã nem
  -- número errado. É o oposto do caso de `orcamento_categoria_metodo`, onde a
  -- chave decide por onde a categoria é orçada e um valor desconhecido a deixaria
  -- sem tela; lá o CHECK fica.
  metodo text NOT NULL,
  ocultado_em timestamptz NOT NULL DEFAULT now(),
  ocultado_por uuid REFERENCES public.users(id) ON DELETE SET NULL,
  PRIMARY KEY (company_id, metodo)
);

CREATE INDEX IF NOT EXISTS orcamento_metodos_ocultos_empresa_idx
  ON public.orcamento_metodos_ocultos (company_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- A LEITURA é de qualquer usuário do módulo que alcance a empresa: o hub precisa
-- dela para decidir quais caixas desenhar, e um gerente que não pudesse ler
-- veria o hub cheio e tomaria redirect ao clicar.
--
-- A escrita é admin-only na action (é configuração geral do módulo, como os
-- índices). A policy de admin fica como segunda linha de defesa.
ALTER TABLE public.orcamento_metodos_ocultos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orcamento_metodos_ocultos admin all" ON public.orcamento_metodos_ocultos;
CREATE POLICY "orcamento_metodos_ocultos admin all" ON public.orcamento_metodos_ocultos
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "orcamento_metodos_ocultos orcamento read" ON public.orcamento_metodos_ocultos;
CREATE POLICY "orcamento_metodos_ocultos orcamento read" ON public.orcamento_metodos_ocultos
  FOR SELECT TO authenticated
  USING (public.orcamento_pode_ler_empresa(company_id));

NOTIFY pgrst, 'reload schema';
