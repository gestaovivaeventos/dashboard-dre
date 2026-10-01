-- =============================================================================
-- TIPO de viagem, e o de-para tipo → categoria da DRE (01/10/2026).
--
-- ── Por que a viagem não escolhe a categoria direto ────────────────────────
-- As viagens de uma empresa não caem todas na mesma categoria da Omie:
-- consultoria vai para uma, treinamento para outra, visita a cliente para uma
-- terceira. Pedir a CATEGORIA a quem cadastra a viagem erra por dois lados:
--
--   • é vocabulário de contabilidade. Quem pede a viagem sabe que é "implantação
--     numa unidade nova"; não sabe (nem deveria decidir) se isso é 2.01.98;
--   • a decisão se repete a cada viagem, e duas pessoas classificam a mesma coisa
--     de formas diferentes — o orçamento sai partido entre contas sem que a
--     diferença signifique nada.
--
-- Então quem cadastra escolhe um TIPO (linguagem de negócio) e o de-para
-- tipo → categoria é cadastro do ADMIN, por empresa. Mudou o plano de contas?
-- mexe-se no de-para, não em cada viagem.
--
-- É o mesmo enquadramento de `budget_account_mappings` no Financeiro (rótulo →
-- conta) e dos grupos de despesa do Planejamento: a tela fala a língua de quem
-- preenche, e o mapeamento para a DRE é mantido por quem responde pelo plano.
--
-- ── Por EMPRESA × ANO ─────────────────────────────────────────────────────
-- Como `orcamento_categoria_metodo` e os parâmetros de viagem. O plano de contas
-- muda entre anos, e um de-para global obrigaria a refazer todo janeiro. O nome
-- do tipo é a identidade que atravessa o ano (como no setor do orçamento).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.orcamento_viagem_tipos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year integer NOT NULL,

  -- O nome que aparece no cadastro da viagem ("Consultoria", "Treinamento").
  nome text NOT NULL,
  -- A categoria da Omie onde as viagens deste tipo caem na DRE. NULO é estado
  -- legítimo e deliberado: o admin cadastra os tipos que o negócio usa e pode
  -- mapear depois. Tipo sem categoria NÃO é oferecido no cadastro da viagem —
  -- oferecê-lo produziria viagem que não entra em número nenhum, em silêncio.
  category_code text,

  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

-- Nome único por empresa × ano, sem depender de caixa/espaço — a mesma
-- normalização dos grupos de despesa.
CREATE UNIQUE INDEX IF NOT EXISTS orcamento_viagem_tipos_nome_idx
  ON public.orcamento_viagem_tipos (company_id, year, lower(btrim(nome)));

CREATE INDEX IF NOT EXISTS orcamento_viagem_tipos_empresa_idx
  ON public.orcamento_viagem_tipos (company_id, year);

-- ── A viagem passa a apontar para o TIPO ────────────────────────────────────
-- `category_code` CONTINUA na viagem, e isso não é redundância: é o retrato da
-- categoria em que ela foi orçada, resolvido pelo de-para no momento da
-- gravação. Três coisas dependem disso:
--
--   1. a `source` da finalização inclui a categoria. Se a categoria da viagem
--      mudasse sozinha ao se remapear o tipo, a fatia já publicada no Budget
--      ficaria órfã (reabrir apaga por source, e a source teria mudado) — o
--      Financeiro somaria o valor duas vezes, em duas contas;
--   2. a decisão da diretoria foi tomada sobre uma viagem numa conta; mudá-la
--      por baixo reclassifica um número já aprovado sem ninguém decidir;
--   3. é a mesma razão pela qual o custo é retrato e o Plano de Cargos COPIA o
--      salário: config que muda não pode mexer no que já foi fechado.
--
-- Remapear o tipo vale para as viagens salvas DEPOIS. A tela de de-para diz
-- quantas viagens ainda carregam o mapeamento antigo.
ALTER TABLE public.orcamento_viagens
  ADD COLUMN IF NOT EXISTS tipo_id uuid REFERENCES public.orcamento_viagem_tipos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS orcamento_viagens_tipo_idx
  ON public.orcamento_viagens (tipo_id);

-- `category_code` era NOT NULL (a viagem nascia com a categoria escolhida à mão).
-- Com o tipo, ela nasce sem categoria e a ganha quando o tipo é escolhido e o
-- de-para resolve. Recusar o rascunho sem categoria obrigaria a decidir
-- contabilidade antes de descrever a viagem, que é o que esta mudança desfaz.
ALTER TABLE public.orcamento_viagens
  ALTER COLUMN category_code DROP NOT NULL;

-- ── RLS: mesmo padrão do resto do módulo ────────────────────────────────────
-- Admin faz tudo; quem alcança a empresa no Orçamento LÊ. A escrita do de-para é
-- admin-only na action (premissa da empresa, como os parâmetros e os encargos).
ALTER TABLE public.orcamento_viagem_tipos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orcamento_viagem_tipos admin all" ON public.orcamento_viagem_tipos;
CREATE POLICY "orcamento_viagem_tipos admin all" ON public.orcamento_viagem_tipos
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "orcamento_viagem_tipos orcamento read" ON public.orcamento_viagem_tipos;
CREATE POLICY "orcamento_viagem_tipos orcamento read" ON public.orcamento_viagem_tipos
  FOR SELECT TO authenticated
  USING (public.orcamento_pode_ler_empresa(company_id));

NOTIFY pgrst, 'reload schema';
