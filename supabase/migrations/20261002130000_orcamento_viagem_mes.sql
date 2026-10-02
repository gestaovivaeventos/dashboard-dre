-- =============================================================================
-- A viagem passa a ter MÊS, não data (02/10/2026).
--
-- No orçamento ninguém sabe o dia: o gestor sabe "Curitiba em março". O campo
-- `data_ida` exigia um dia, e um dia inventado PARECE informação — pior do que
-- não ter. Pior ainda: `enviarViagem` recusava a viagem sem data completa, então
-- a trava existia para proteger um dado que não existe.
--
-- O custo inteiro já caía no mês da partida (a DRE é caixa, e passagem e hotel
-- são pagos antes de viajar), então o motor nunca usou o dia para nada além de
-- extrair o mês.
--
-- `data_ida` FICA na tabela, sem leitor novo: as viagens criadas antes desta
-- migration têm data completa, e `mapear.ts` cai nela (`mesDaData`) quando
-- `mes_ida` está nulo. Mesma convenção das outras colunas mortas do módulo — não
-- a remova, e não volte a escrever nela.
-- =============================================================================

ALTER TABLE public.orcamento_viagens
  ADD COLUMN IF NOT EXISTS mes_ida smallint;

ALTER TABLE public.orcamento_viagens
  DROP CONSTRAINT IF EXISTS orcamento_viagens_mes_ida_check;

ALTER TABLE public.orcamento_viagens
  ADD CONSTRAINT orcamento_viagens_mes_ida_check
  CHECK (mes_ida IS NULL OR (mes_ida BETWEEN 1 AND 12));

-- Converte o que já existe: o mês sai da data que estava lá. Idempotente — roda
-- de novo sem efeito, porque só preenche quem está nulo.
UPDATE public.orcamento_viagens
SET mes_ida = EXTRACT(MONTH FROM data_ida)::smallint
WHERE mes_ida IS NULL
  AND data_ida IS NOT NULL;

CREATE INDEX IF NOT EXISTS orcamento_viagens_mes_idx
  ON public.orcamento_viagens (company_id, year, mes_ida);

NOTIFY pgrst, 'reload schema';
