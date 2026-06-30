-- Garante no banco que não exista mais de um fornecedor não-rejeitado com o
-- mesmo CNPJ/CPF (comparado por dígitos). Rejeitados ficam livres para permitir
-- recadastro legítimo após rejeição. Defesa em profundidade além do dedupe do
-- app (createSupplier/updateSupplier) — cobre corridas e inserts fora do fluxo.
create unique index if not exists ctrl_suppliers_doc_norm_unique
  on public.ctrl_suppliers (regexp_replace(coalesce(cnpj_cpf, ''), '\D', '', 'g'))
  where status <> 'rejeitado'
    and regexp_replace(coalesce(cnpj_cpf, ''), '\D', '', 'g') <> '';
