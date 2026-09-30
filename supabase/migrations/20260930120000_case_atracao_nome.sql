-- Nome artístico da atração no contrato. O cadastro (case_bands) é o
-- favorecido do pagamento — muitas vezes a empresa da banda —, então o nome
-- que aparece no evento fica na própria atração do contrato. NULL = usa o
-- nome do cadastro. Vai na observação do contas a pagar na Omie.
ALTER TABLE public.case_contract_atracoes ADD COLUMN IF NOT EXISTS nome_atracao text;
