-- CNPJ ALFANUMÉRICO (Receita Federal, vigente a partir de jul/2026).
--
-- A deduplicação de fornecedor por documento normalizava só os DÍGITOS
-- (regexp_replace(..., '\D', '')). Com o CNPJ alfanumérico isso derruba as
-- letras das 12 primeiras posições, fazendo dois CNPJs diferentes colidirem
-- como se fossem o mesmo (e um alfanumérico bater falso contra um numérico
-- existente). Passa a normalizar por ALFANUMÉRICO em caixa alta.
--
-- Seguro para o legado: documentos 100% numéricos continuam gerando a mesma
-- chave (só dígitos, upper não muda), então nenhum par existente passa a
-- colidir. É estritamente mais permissivo (as letras agora contam).

-- 1) Função de dedupe usada por createSupplier/updateSupplier.
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
    and upper(regexp_replace(coalesce(p_doc, ''), '[^0-9A-Za-z]', '', 'g')) <> ''
    and upper(regexp_replace(coalesce(s.cnpj_cpf, ''), '[^0-9A-Za-z]', '', 'g'))
        = upper(regexp_replace(coalesce(p_doc, ''), '[^0-9A-Za-z]', '', 'g'));
$$;

grant execute on function public.ctrl_find_supplier_by_doc(text) to authenticated, service_role;

-- 2) Índice único (defesa em profundidade no banco). Índice não aceita
-- `create or replace`: derruba o antigo (por dígitos) e recria por alfanumérico.
drop index if exists public.ctrl_suppliers_doc_norm_unique;

create unique index if not exists ctrl_suppliers_doc_norm_unique
  on public.ctrl_suppliers (upper(regexp_replace(coalesce(cnpj_cpf, ''), '[^0-9A-Za-z]', '', 'g')))
  where status <> 'rejeitado'
    and upper(regexp_replace(coalesce(cnpj_cpf, ''), '[^0-9A-Za-z]', '', 'g')) <> '';
