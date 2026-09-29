-- ============================================================================
-- Departamento Pessoal — espelho do cadastro de colaboradores da Sólides.
--
-- A Sólides (Gestão de Pessoas) é a FONTE: o cadastro é mantido lá e aqui é
-- espelho de leitura, atualizado por cron diário e pelo botão da tela. A folha
-- continua na contabilidade.
--
-- Depende de 20260929150000_dp_module.sql (dp_has_access()).
--
--   dp_colaboradores   — um por colaborador da Sólides (solides_id). Quem some
--                        da lista da Sólides vira ativo=false; nunca é apagado.
--   dp_empresa_regras  — de-para Sólides → empresa do Control Hub, por UNIDADE
--                        ou, quando o colaborador não tem unidade, por
--                        DEPARTAMENTO. A empresa NÃO é gravada no colaborador:
--                        é resolvida na leitura (src/lib/dp/empresa.ts), então
--                        mudar uma regra reflete na hora, sem re-sync.
--   dp_sync_runs       — cada execução da sincronização.
--
-- Dados que NÃO vêm para cá, por decisão do dono do projeto (29/09/2026):
-- conta bancária, RG, PIS, CTPS, filiação, título de eleitor. Ficam só na
-- Sólides.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.dp_colaboradores (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  solides_id             BIGINT NOT NULL UNIQUE,
  nome                   TEXT NOT NULL,
  cpf                    TEXT,
  email                  TEXT,
  unidade_id             BIGINT,
  unidade_nome           TEXT,
  departamento_id        BIGINT,
  departamento_nome      TEXT,
  cargo_id               BIGINT,
  cargo_nome             TEXT,
  tipo_contrato          TEXT,
  data_admissao          DATE,
  data_desligamento      DATE,
  gestor_solides_id      BIGINT,
  gestor_nome            TEXT,
  -- NULL = não informado na Sólides (ela devolve "R$ 0,00" nesse caso).
  salario                NUMERIC(14,2),
  endereco               JSONB,
  -- Presente na última lista da Sólides (a lista só traz ativos).
  ativo                  BOOLEAN NOT NULL DEFAULT TRUE,
  desligado_detectado_em TIMESTAMPTZ,
  -- "updated_at" da Sólides: só a DATA (DD/MM/AAAA), sem hora.
  solides_atualizado_em  DATE,
  ficha_sincronizada_em  TIMESTAMPTZ,
  sincronizado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dp_colaboradores_cpf_idx ON public.dp_colaboradores (cpf);

CREATE TABLE IF NOT EXISTS public.dp_empresa_regras (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  origem       TEXT NOT NULL CHECK (origem IN ('unidade', 'departamento')),
  solides_id   BIGINT NOT NULL,
  solides_nome TEXT NOT NULL,
  company_id   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  updated_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (origem, solides_id)
);

CREATE TABLE IF NOT EXISTS public.dp_sync_runs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger            TEXT NOT NULL CHECK (trigger IN ('cron', 'manual')),
  status             TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'erro')),
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at        TIMESTAMPTZ,
  colaboradores_lista INT,
  fichas_ok          INT NOT NULL DEFAULT 0,
  fichas_erro        INT NOT NULL DEFAULT 0,
  novos              INT NOT NULL DEFAULT 0,
  desligados         INT NOT NULL DEFAULT 0,
  reativados         INT NOT NULL DEFAULT 0,
  erro               TEXT,
  created_by         UUID REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS dp_sync_runs_started_idx ON public.dp_sync_runs (started_at DESC);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Leitura só com a concessão do módulo (dp_has_access). NUNCA is_admin(): admin
-- não passa por cima neste módulo. Sem policy de escrita: toda escrita é do
-- service role, depois de requireDpUser() no app ou do cron.
ALTER TABLE public.dp_colaboradores  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dp_empresa_regras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dp_sync_runs      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dp_colaboradores_select ON public.dp_colaboradores;
CREATE POLICY dp_colaboradores_select ON public.dp_colaboradores
  FOR SELECT TO authenticated USING (public.dp_has_access());

DROP POLICY IF EXISTS dp_empresa_regras_select ON public.dp_empresa_regras;
CREATE POLICY dp_empresa_regras_select ON public.dp_empresa_regras
  FOR SELECT TO authenticated USING (public.dp_has_access());

DROP POLICY IF EXISTS dp_sync_runs_select ON public.dp_sync_runs;
CREATE POLICY dp_sync_runs_select ON public.dp_sync_runs
  FOR SELECT TO authenticated USING (public.dp_has_access());

-- ── De-para inicial ─────────────────────────────────────────────────────────
-- Só os casos em que o nome da Sólides não deixa dúvida. Ficam de fora, para
-- decisão na tela: as razões sociais das franquias (V EVENTOS BRASIL, MINAS
-- FEST, CGR FEST, CURITIBA FEST, OLIVEIRA MEDEIROS, VIVA MIXX, VG, CELEBRATE,
-- TRIANGULO), UTB/UNITICKET, SALVATERRA (Estacionamento ou Mall?), CUBO
-- PRODUÇÕES (não é empresa no Control Hub) e "- FRANQUEADORA" (VE Franqueadora
-- ou a Filial?). Empresa não encontrada pelo nome simplesmente não gera regra.
INSERT INTO public.dp_empresa_regras (origem, solides_id, solides_nome, company_id)
SELECT r.origem, r.solides_id, r.solides_nome, c.id
FROM (VALUES
  ('unidade', 69141, 'SPOT', 'Spot'),
  ('unidade', 69131, 'DATAFORTE CSC', 'Dataforte'),
  ('unidade', 86584, 'YOUNG MED', 'Young Med'),
  ('unidade', 69136, 'EXPRESS', 'Express'),
  ('unidade', 69134, 'CASE SHOWS', 'Case Shows'),
  ('unidade', 69138, 'SGX ADMINISTRAÇÃO', 'SGX'),
  ('departamento', 407669, 'OPERACIONAL - EXPRESS', 'Express'),
  ('departamento', 407672, 'OPERACIONAL - SGX ADMINISTRAÇÃO', 'SGX'),
  ('departamento', 407673, 'ADMINISTRATIVO - SGX ADMINISTRAÇÃO', 'SGX'),
  ('departamento', 407675, 'OPERACIONAL - SPOT', 'Spot'),
  ('departamento', 407676, 'ADMINISTRATIVO - SPOT', 'Spot'),
  ('departamento', 407695, 'RELACIONAMENTO - VIVA BH', 'Viva Belo Horizonte'),
  ('departamento', 407696, 'COMERCIAL - VIVA BH', 'Viva Belo Horizonte'),
  ('departamento', 407698, 'ADMINISTRATIVO - VIVA BH', 'Viva Belo Horizonte'),
  ('departamento', 407699, 'PRODUÇÃO - VIVA BH', 'Viva Belo Horizonte'),
  ('departamento', 407700, 'MARKETING - VIVA BH', 'Viva Belo Horizonte'),
  ('departamento', 407723, 'PRODUÇÃO - VIVA CAMPO GRANDE', 'Viva Campo Grande'),
  ('departamento', 407724, 'RELACIONAMENTO - VIVA CAMPO GRANDE', 'Viva Campo Grande'),
  ('departamento', 407726, 'COMERCIAL - VIVA CAMPO GRANDE', 'Viva Campo Grande'),
  ('departamento', 407727, 'ADMINISTRATIVO - VIVA CAMPO GRANDE', 'Viva Campo Grande'),
  ('departamento', 476056, 'MARKETING - VIVA CAMPO GRANDE', 'Viva Campo Grande'),
  ('departamento', 407730, 'COMERCIAL - VIVA GO', 'Viva Go'),
  ('departamento', 407733, 'RELACIONAMENTO - VIVA GO', 'Viva Go'),
  ('departamento', 407735, 'MARKETING - VIVA GO', 'Viva Go'),
  ('departamento', 407737, 'PRODUÇÃO - VIVA GO', 'Viva Go'),
  ('departamento', 407745, 'ADMINISTRATIVO - VIVA JUIZ DE FORA', 'Viva Juiz de Fora'),
  ('departamento', 407746, 'RELACIONAMENTO - VIVA JUIZ DE FORA', 'Viva Juiz de Fora'),
  ('departamento', 407747, 'PRODUÇÃO - VIVA JUIZ DE FORA', 'Viva Juiz de Fora'),
  ('departamento', 407748, 'COMERCIAL - VIVA JUIZ DE FORA', 'Viva Juiz de Fora'),
  ('departamento', 407749, 'MARKETING - VIVA JUIZ DE FORA', 'Viva Juiz de Fora'),
  ('departamento', 407757, 'ADMINISTRATIVO - VIVA PETROPOLIS', 'Viva Petropolis'),
  ('departamento', 407758, 'RELACIONAMENTO - VIVA PETROPOLIS', 'Viva Petropolis'),
  ('departamento', 407778, 'RELACIONAMENTO - VIVA VR', 'Viva Volta Redonda'),
  ('departamento', 407779, 'COMERCIAL - VIVA VR', 'Viva Volta Redonda'),
  ('departamento', 407780, 'ADMINISTRATIVO - VIVA VR', 'Viva Volta Redonda'),
  ('departamento', 407781, 'PRODUÇÃO - VIVA VR', 'Viva Volta Redonda'),
  ('departamento', 407822, 'ADMINISTRATIVO - VIVA UBERABA', 'Viva Uberaba'),
  ('departamento', 407827, 'ADMINISTRATIVO - VIVA CUIABA', 'Viva Cuiaba'),
  ('departamento', 408343, 'RELACIONAMENTO - VIVA CUIABA', 'Viva Cuiaba'),
  ('departamento', 458685, 'COMERCIAL - VIVA CUIABA', 'Viva Cuiaba'),
  ('departamento', 407828, 'ADMINISTRATIVO - CASE SHOWS', 'Case Shows'),
  ('departamento', 459381, 'COMERCIAL - VIVA CURITIBA', 'Viva Curitiba'),
  ('departamento', 461456, 'PRODUÇÃO - VIVA CURITIBA', 'Viva Curitiba'),
  ('departamento', 461427, 'INOVAÇÃO - YOUNG MED', 'Young Med'),
  ('departamento', 461450, 'ADMINISTRATIVO - YOUNG MED', 'Young Med'),
  ('departamento', 465456, 'COMERCIAL - VIVA BARBACENA', 'Viva Barbacena'),
  ('departamento', 465457, 'PRODUÇÃO - VIVA BARBACENA', 'Viva Barbacena')
) AS r(origem, solides_id, solides_nome, company_name)
JOIN public.companies c ON c.name = r.company_name
ON CONFLICT (origem, solides_id) DO NOTHING;

COMMENT ON TABLE public.dp_colaboradores IS
  'DP (sigiloso): espelho do cadastro da Sólides. Leitura só com dp_has_access(); escrita só service role. Empresa resolvida por dp_empresa_regras na leitura.';
COMMENT ON TABLE public.dp_empresa_regras IS
  'DP: de-para Sólides → empresa, por unidade (prioridade) ou departamento (quando o colaborador não tem unidade).';
