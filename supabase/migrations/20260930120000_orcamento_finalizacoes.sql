-- =============================================================================
-- Finalizar Orçamento — o fechamento por (método × categoria × setor).
--
-- Duas coisas acontecem no clique do administrador:
--   1. aquela fatia do orçamento TRAVA para todo mundo, inclusive para ele
--      (reabrir é o único caminho de volta, e é dele também);
--   2. a parte APROVADA pela diretoria vai para o Budget do Financeiro.
--
-- ── Por que uma LINHA POR FATIA, apagada ao reabrir ────────────────────────
-- "Existe linha = está finalizado" é a semântica inteira. Guardar um estado
-- (`aberto`/`fechado`) numa linha que sempre existe traria de volta o problema
-- que derrubou o CICLO em 24/09/2026: a empresa ficava presa num estado sem
-- caminho de tela para sair. Aqui, se a linha some, a fatia volta a ser
-- editável — não há como prender ninguém. O histórico de quem fechou e quando
-- é da trilha (`orcamento_alteracoes`), que já registra tudo.
--
-- ── A chave tem COALESCE ──────────────────────────────────────────────────
-- Setor nulo é valor LEGÍTIMO (empresa que não orça por setor), então o único
-- índice possível é por expressão — o mesmo enquadramento de
-- `orcamento_grupo_escopo`. Consequência que o app precisa respeitar:
-- `upsert({ ignoreDuplicates: true })` NÃO funciona sobre índice por expressão
-- (ver o alerta no CLAUDE.md). A gravação é INSERT, e 23505 se lê como
-- "alguém acabou de finalizar".
--
-- `category_code` vazio ('') é a fatia do PESSOAL: lá a unidade é o quadro do
-- setor inteiro — salários, encargos e benefícios saem juntos, porque o motor
-- é linear por colaborador e separá-los publicaria pedaço de gente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.orcamento_finalizacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  metodo text NOT NULL CHECK (metodo IN ('pessoal', 'media', 'valor_fixo', 'planejamento_socios')),
  -- '' = a fatia inteira do método (hoje só o pessoal usa).
  category_code text NOT NULL DEFAULT '',
  setor_id uuid REFERENCES public.orcamento_setores(id) ON DELETE CASCADE,

  -- Retrato do que FOI publicado, para a tela dizer o que entrou sem recalcular
  -- a prévia inteira (e para auditar depois de o orçamento ter mudado).
  total_publicado numeric NOT NULL DEFAULT 0,
  itens_publicados integer NOT NULL DEFAULT 0,
  itens_fora integer NOT NULL DEFAULT 0,

  finalizado_em timestamptz NOT NULL DEFAULT now(),
  finalizado_por uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS orcamento_finalizacoes_chave_idx
  ON public.orcamento_finalizacoes (
    company_id,
    year,
    metodo,
    category_code,
    COALESCE(setor_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX IF NOT EXISTS orcamento_finalizacoes_empresa_ano_idx
  ON public.orcamento_finalizacoes (company_id, year);

-- =============================================================================
-- Abertura da publicação, para o drilldown no Budget.
--
-- O Budget soma por CONTA (`reprocess.ts` agrega `budget_uploads_raw` por
-- dre_account_id), então o nome da despesa se perde no caminho — de propósito,
-- é assim que o Financeiro funciona. Esta tabela guarda a abertura ao lado,
-- só para leitura: nada aqui entra em nenhum número do Financeiro.
--
-- Não se põe o nome da despesa como `label` em `budget_uploads_raw` para
-- resolver isso: `budget_account_mappings` é único por (company_id, label), duas
-- despesas homônimas em contas diferentes colidiriam, e a tela de rótulos não
-- mapeados encheria de centenas de nomes.
--
-- `source` é a FATIA (a mesma string usada em budget_uploads_raw), o que torna
-- reabrir uma exclusão por source nas duas tabelas.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.orcamento_budget_detalhe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  source text NOT NULL,
  dre_account_id uuid NOT NULL,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  nome text NOT NULL,
  valor numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orcamento_budget_detalhe_conta_idx
  ON public.orcamento_budget_detalhe (company_id, year, dre_account_id, month);

CREATE INDEX IF NOT EXISTS orcamento_budget_detalhe_source_idx
  ON public.orcamento_budget_detalhe (company_id, year, source);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Leitura para quem alcança a empresa no módulo Orçamento; ESCRITA só pelo
-- service_role (que ignora RLS), depois do gate de admin na action. O drilldown
-- do Budget lê com o admin client depois da autorização do Financeiro — como já
-- fazem as páginas de /contratos e do Caixa —, porque quem abre o Budget pode
-- não ter o módulo Orçamento.
ALTER TABLE public.orcamento_finalizacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orcamento_budget_detalhe ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Orcamento le finalizacoes" ON public.orcamento_finalizacoes;
CREATE POLICY "Orcamento le finalizacoes" ON public.orcamento_finalizacoes
  FOR SELECT TO authenticated
  USING (public.orcamento_pode_ler_empresa(company_id));

DROP POLICY IF EXISTS "Orcamento le detalhe" ON public.orcamento_budget_detalhe;
CREATE POLICY "Orcamento le detalhe" ON public.orcamento_budget_detalhe
  FOR SELECT TO authenticated
  USING (public.orcamento_pode_ler_empresa(company_id));

NOTIFY pgrst, 'reload schema';
