-- ============================================================================
-- Compras (CTRL) multiempresa — ETAPA E (schema): fecha o que ficou acoplado a
-- código. Ver docs/superpowers/specs/2026-10-06-ctrl-multiempresa-design.md.
--
-- Depende da etapa C + Migration D já no ar. Aplicar antes de a Feat registrar
-- fornecedores.
--
--   1. DROP DEFAULT de org_id nas 5 tabelas. A partir daqui, um insert que NÃO
--      passe org_id FALHA (em vez de cair calado na Viva). Seguro: todos os
--      caminhos de insert do código já gravam org_id (auditado em 07/10, inclui
--      a correção do upload de orçamento).
--   2. Fornecedor por EMPRESA: o índice de CNPJ e o RPC de dedupe passam a ser
--      por empresa — a Feat pode ter um fornecedor com o mesmo CNPJ da Viva.
--      EXPAND/CONTRACT: o RPC ganha p_org OPCIONAL (default null = global, o
--      comportamento do código atual), então aplicar isto NÃO quebra o código já
--      no ar; o createSupplier passa a mandar a empresa num deploy seguinte.
-- ============================================================================

-- 1. DROP DEFAULT (o NOT NULL da etapa D continua).
do $$
declare
  t text;
begin
  foreach t in array array[
    'ctrl_sectors','ctrl_expense_types','ctrl_requests','ctrl_events','ctrl_suppliers'
  ] loop
    execute format('alter table public.%I alter column org_id drop default', t);
  end loop;
end $$;

-- 2a. Índice único de CNPJ por EMPRESA (era global). Sem violação hoje: tudo é
--     Viva e cada CNPJ aparece uma vez, então (org_id, doc) também é único.
drop index if exists public.ctrl_suppliers_doc_norm_unique;
create unique index if not exists ctrl_suppliers_doc_norm_unique
  on public.ctrl_suppliers (
    org_id,
    upper(regexp_replace(coalesce(cnpj_cpf, ''), '[^0-9A-Za-z]', '', 'g'))
  )
  where status <> 'rejeitado'
    and upper(regexp_replace(coalesce(cnpj_cpf, ''), '[^0-9A-Za-z]', '', 'g')) <> '';

-- 2b. RPC de dedupe org-aware. Troca a assinatura (de (text) para
--     (text, uuid default null)); chamada com só p_doc continua resolvendo para
--     esta função (p_org = null = busca global = comportamento atual). Preserva o
--     corpo da 20260903120000 (normalização alfanumérica + gate has_ctrl_role).
drop function if exists public.ctrl_find_supplier_by_doc(text);
create or replace function public.ctrl_find_supplier_by_doc(p_doc text, p_org uuid default null)
returns table (id uuid, name text, status text, cnpj_cpf text)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.status::text, s.cnpj_cpf
  from public.ctrl_suppliers s
  where public.has_ctrl_role(ARRAY['admin','solicitante','gerente','diretor','csc','contas_a_pagar','aprovacao_fornecedor'])
    and (p_org is null or s.org_id = p_org)
    and s.status <> 'rejeitado'
    and upper(regexp_replace(coalesce(p_doc, ''), '[^0-9A-Za-z]', '', 'g')) <> ''
    and upper(regexp_replace(coalesce(s.cnpj_cpf, ''), '[^0-9A-Za-z]', '', 'g'))
        = upper(regexp_replace(coalesce(p_doc, ''), '[^0-9A-Za-z]', '', 'g'));
$$;
revoke execute on function public.ctrl_find_supplier_by_doc(text, uuid) from public, anon;
grant execute on function public.ctrl_find_supplier_by_doc(text, uuid) to authenticated, service_role;
