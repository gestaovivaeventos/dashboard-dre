-- =============================================================================
-- Plano de Cargos — benefícios por NÍVEL (29/09/2026).
--
-- Até aqui o benefício só existia por colaborador, digitado um a um na aba
-- Benefícios: 7 colunas × N pessoas, toda vez que alguém entra no quadro. O
-- plano já removia esse trabalho para o SALÁRIO; agora remove para o resto do
-- pacote.
--
-- ── Por que no NÍVEL, e não no cargo ───────────────────────────────────────
-- É onde `salario` já mora. Todo o dinheiro do plano fica numa linha só, e
-- benefício que varia por senioridade (plano de saúde, por exemplo) tem como
-- ser expresso. No cargo seria uma digitação a menos, mas criaria um SEGUNDO
-- lugar onde dinheiro mora e obrigaria a escolha do cargo a juntar duas fontes.
--
-- ── O valor é COPIADO, não referenciado ────────────────────────────────────
-- Escolher o cargo copia estes valores para o colaborador, exatamente como já
-- faz com o salário — `orcamento_pessoal_colaboradores` guarda um RETRATO, não
-- um ponteiro para o plano. Consequência desejada: editar o plano em novembro
-- não mexe em quem já está no quadro. Um "fallback vivo" (célula vazia que
-- busca do plano na hora de calcular) foi descartado de propósito: seria uma
-- célula que parece vazia e produz número.
--
-- NULL = o plano não define este benefício. Nada é pré-preenchido e o
-- administrador segue preenchendo na aba Benefícios, como hoje. NULL é
-- diferente de 0: zero é "esta pessoa não recebe", nulo é "o plano não diz".
--
-- As colunas espelham 1:1 as de `orcamento_pessoal_colaboradores` (mesmos
-- nomes), que por sua vez espelham as chaves de `src/lib/orcamento/beneficios.ts`
-- — acrescentar um benefício novo continua sendo: entrada naquele arquivo +
-- coluna nas DUAS tabelas.
-- =============================================================================

ALTER TABLE public.orcamento_cargo_niveis
  ADD COLUMN IF NOT EXISTS vale_transporte numeric,
  ADD COLUMN IF NOT EXISTS beneficio_gasolina numeric,
  ADD COLUMN IF NOT EXISTS beneficio_alimentacao numeric,
  ADD COLUMN IF NOT EXISTS refeicoes_empresa numeric,
  ADD COLUMN IF NOT EXISTS assistencia_medica numeric,
  ADD COLUMN IF NOT EXISTS auxilio_home_office numeric,
  ADD COLUMN IF NOT EXISTS seguro_vida numeric;

-- Valor de benefício não é negativo. Sem NOT NULL: nulo é "o plano não diz".
DO $$
DECLARE
  col text;
BEGIN
  FOREACH col IN ARRAY ARRAY[
    'vale_transporte', 'beneficio_gasolina', 'beneficio_alimentacao',
    'refeicoes_empresa', 'assistencia_medica', 'auxilio_home_office',
    'seguro_vida'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'orcamento_cargo_niveis_' || col || '_chk'
        AND conrelid = 'public.orcamento_cargo_niveis'::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.orcamento_cargo_niveis ADD CONSTRAINT %I CHECK (%I IS NULL OR %I >= 0)',
        'orcamento_cargo_niveis_' || col || '_chk', col, col
      );
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
