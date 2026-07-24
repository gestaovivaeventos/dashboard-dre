-- Sub-tipo da transferência padrão do fornecedor: Conta Corrente x Poupança.
--
-- O checkbox "Usar transferência como método de pagamento padrão" virou dois
-- checkboxes mutuamente exclusivos (Conta Corrente / Conta Poupança). O flag
-- transf_padrao continua indicando que a transferência é o método padrão; esta
-- coluna guarda QUAL tipo de conta, para definir a "Finalidade" no lançamento
-- em contas a pagar (a Omie não tem esse campo no cadastro do fornecedor).
--
-- Cadastros legados com transf_padrao=true e valor nulo aqui são tratados como
-- "corrente" na aplicação (comportamento anterior).

ALTER TABLE public.ctrl_suppliers
  ADD COLUMN IF NOT EXISTS transf_tipo_conta TEXT
    CHECK (transf_tipo_conta IN ('corrente', 'poupanca'));

COMMENT ON COLUMN public.ctrl_suppliers.transf_tipo_conta IS
  'Tipo da conta na transferência padrão: corrente ou poupanca. Só relevante quando transf_padrao=true; define a finalidade no lançamento em contas a pagar.';
