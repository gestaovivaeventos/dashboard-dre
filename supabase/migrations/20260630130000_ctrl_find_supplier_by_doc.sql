-- Dedupe de fornecedor por documento normalizado (só dígitos), feito no banco.
-- O dedupe antigo carregava ctrl_suppliers inteiro no JS e o PostgREST corta em
-- 1000 linhas; com >1000 fornecedores, documentos além da linha 1000 escapavam e
-- permitiam recadastro duplicado. Esta função compara só dígitos no servidor e
-- retorna apenas os matches, independente do volume.
create or replace function public.ctrl_find_supplier_by_doc(p_doc text)
returns table (id uuid, name text, status text, cnpj_cpf text)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.name, s.status::text, s.cnpj_cpf
  from public.ctrl_suppliers s
  where s.status <> 'rejeitado'
    and regexp_replace(coalesce(p_doc, ''), '\D', '', 'g') <> ''
    and regexp_replace(coalesce(s.cnpj_cpf, ''), '\D', '', 'g')
        = regexp_replace(coalesce(p_doc, ''), '\D', '', 'g');
$$;

grant execute on function public.ctrl_find_supplier_by_doc(text) to authenticated, service_role;
