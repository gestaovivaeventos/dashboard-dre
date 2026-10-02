-- ============================================================================
-- Departamento Pessoal — a tabela salarial perde a coluna STEP.
--
-- Pedido do dono do projeto (02/10/2026): a tabela passa a ser
-- `Setor | Cargo | Salário`, e o step COMPÕE O NOME DO CARGO
-- ("Auxiliar Administrativo" + step "1" → "Auxiliar Administrativo 1").
-- Nenhum valor se perde: cada linha continua existindo, só que o step vai
-- para dentro do cargo. Na aplicação, a VE Franqueadora tinha 660 linhas
-- (132 cargos × steps 1 a 5) e nenhum vínculo com a Sólides.
--
-- `cargo_chave` novo = cargo_chave || ' ' || step_chave: as duas já são a
-- forma normalizada do app (chaveNome colapsa qualquer separador num espaço
-- só), então a concatenação é exatamente a chave do nome novo.
-- ============================================================================

-- Juntar o step ao cargo não pode criar duas linhas iguais (ex.: um cargo
-- "Analista 1" sem step ao lado de "Analista" + step "1"). Se criar, PARA:
-- decidir qual das duas fica é escolha de quem cadastrou, não da migration.
DO $$
DECLARE
  v_colisoes INT;
BEGIN
  SELECT count(*) INTO v_colisoes FROM (
    SELECT company_id, setor_chave,
           btrim(cargo_chave || CASE WHEN step_chave <> '' THEN ' ' || step_chave ELSE '' END) AS chave
    FROM public.dp_tabela_salarial
    GROUP BY 1, 2, 3
    HAVING count(*) > 1
  ) c;
  IF v_colisoes > 0 THEN
    RAISE EXCEPTION 'Juntar o step ao cargo criaria % linha(s) repetida(s) — resolva na tela antes de aplicar.', v_colisoes;
  END IF;
END $$;

UPDATE public.dp_tabela_salarial
   SET cargo = btrim(cargo || CASE WHEN btrim(step) <> '' THEN ' ' || btrim(step) ELSE '' END),
       cargo_chave = btrim(cargo_chave || CASE WHEN step_chave <> '' THEN ' ' || step_chave ELSE '' END),
       updated_at = now()
 WHERE btrim(step) <> '';

-- DROP COLUMN leva junto o UNIQUE (company_id, setor_chave, cargo_chave, step_chave).
ALTER TABLE public.dp_tabela_salarial DROP COLUMN IF EXISTS step_chave;
ALTER TABLE public.dp_tabela_salarial DROP COLUMN IF EXISTS step;

ALTER TABLE public.dp_tabela_salarial DROP CONSTRAINT IF EXISTS dp_tabela_salarial_company_setor_cargo_key;
ALTER TABLE public.dp_tabela_salarial
  ADD CONSTRAINT dp_tabela_salarial_company_setor_cargo_key UNIQUE (company_id, setor_chave, cargo_chave);

-- "Ordenar A–Z" agora por setor e cargo, com o número do fim do nome em ordem
-- NUMÉRICA: "Auxiliar 2" antes de "Auxiliar 10" (a ordem alfabética poria o 10
-- logo depois do 1, e é justamente o step que agora mora no fim do nome).
CREATE OR REPLACE FUNCTION public.dp_ordenar_tabela(p_company_id UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.dp_tabela_salarial t
     SET ordem = o.n
    FROM (
      SELECT id, row_number() OVER (
        ORDER BY setor_chave,
                 regexp_replace(cargo_chave, '\s*\d+$', ''),
                 coalesce(substring(cargo_chave FROM '(\d+)$')::numeric, -1),
                 cargo_chave
      ) AS n
      FROM public.dp_tabela_salarial
      WHERE company_id = p_company_id
    ) o
   WHERE t.id = o.id;
$$;

REVOKE EXECUTE ON FUNCTION public.dp_ordenar_tabela(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dp_ordenar_tabela(UUID) TO service_role;

COMMENT ON TABLE public.dp_tabela_salarial IS 'DP (sigiloso): tabela salarial de cada empresa — Setor | Cargo | Salário (o step compõe o nome do cargo).';
