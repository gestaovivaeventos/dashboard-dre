-- Flag por empresa: NÃO gerar remessa de pagamento (CNAB) no Omie.
--
-- Para empresas cuja conta corrente no Omie não emite remessa de pagamento
-- (ex.: conta sem instituição bancária configurada, ou caixa). Com o flag
-- ligado, o lançamento cria o título em contas a pagar SEM o bloco
-- `cnab_integracao_bancaria` — o pagamento é feito manualmente no Omie. Evita o
-- erro "Não temos suporte para geração da remessa de pagamento no banco - sem
-- instituição - tag: [id_conta_corrente]".
--
-- Configurável na tela Configurações → Mapeamento Omie (toggle por empresa).

ALTER TABLE public.ctrl_company_omie_config
  ADD COLUMN IF NOT EXISTS skip_cnab_remessa boolean NOT NULL DEFAULT false;
