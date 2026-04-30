-- =============================================================================
-- Limpeza robusta de duplicatas pai-vs-baixa em financial_entries.
--
-- Contexto:
-- A API ListarMovimentos da Omie retorna o registro-pai (MANP, BARP, COMP, ...)
-- e a baixa (BAXP/BAXR) como linhas separadas com o mesmo nCodTitulo. O
-- pipeline de sync deve manter apenas a baixa (omie_id no formato `bx:T:B`)
-- e descartar o pai (omie_id `mov:T:...`). O cleanup que existia em sync.ts
-- usava um SELECT em JS sem paginacao, sujeito ao limite default de 1000
-- linhas do PostgREST, deixando duplicatas para tras.
--
-- Esta migration:
-- 1. Cria a funcao public.cleanup_parent_vs_baixa_duplicates() que apaga, em
--    uma unica operacao SQL, todos os `mov:T:%` cujo nCodTitulo possua ao
--    menos um `bx:T:%` na mesma empresa.
-- 2. Roda a funcao uma vez para limpar dados ja gravados.
-- 3. Faz uma deduplicacao adicional por conteudo: linhas que compartilham
--    (company_id, payment_date, value, supplier_customer, description,
--    category_code) mas tem omie_ids diferentes sao consolidadas em uma
--    unica linha (a mais recente). Isso e uma rede de seguranca para
--    duplicatas que nao sao do tipo pai-vs-baixa (ex.: mudanca de cOrigem
--    no Omie entre syncs).
-- =============================================================================

create or replace function public.cleanup_parent_vs_baixa_duplicates(
  p_company_id uuid default null
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_deleted integer;
begin
  with titulos_com_baixa as (
    select distinct
      company_id,
      split_part(omie_id, ':', 2) as n_cod_titulo
    from public.financial_entries
    where omie_id like 'bx:%'
      and (p_company_id is null or company_id = p_company_id)
  ),
  to_delete as (
    select fe.id
    from public.financial_entries fe
    join titulos_com_baixa tcb
      on tcb.company_id = fe.company_id
     and tcb.n_cod_titulo = split_part(fe.omie_id, ':', 2)
    where fe.omie_id like 'mov:%'
      and (p_company_id is null or fe.company_id = p_company_id)
  ),
  deleted as (
    delete from public.financial_entries
    where id in (select id from to_delete)
    returning 1
  )
  select count(*)::integer into v_deleted from deleted;

  return v_deleted;
end;
$$;

grant execute on function public.cleanup_parent_vs_baixa_duplicates(uuid) to authenticated;

-- Roda uma vez para limpar dados ja gravados em todas as empresas.
select public.cleanup_parent_vs_baixa_duplicates(null);

-- ---------------------------------------------------------------------------
-- Rede de seguranca: deduplicacao por conteudo.
--
-- Mantem a linha mais recente (created_at desc, id desc) quando varias linhas
-- compartilham (company_id, payment_date, value, supplier_customer,
-- description, category_code). Esse caso aparece quando o omie_id muda entre
-- syncs por motivos diferentes do par pai-vs-baixa (ex.: cOrigem alterado
-- no Omie, parcela renumerada, etc.).
--
-- Notas:
-- - supplier_customer/description/category_code podem ser NULL — usamos
--   coalesce para que linhas com mesmo NULL sejam consideradas equivalentes.
-- - Sufixo de rateio (:rN) preservado no omie_id evita fundir parcelas
--   legitimas de um rateio: parcelas tem mesmo nCodTitulo mas categorias
--   diferentes (ja distintas pela coluna category_code).
-- ---------------------------------------------------------------------------

with ranked as (
  select
    id,
    row_number() over (
      partition by
        company_id,
        payment_date,
        value,
        coalesce(supplier_customer, ''),
        coalesce(description, ''),
        coalesce(category_code, '')
      order by created_at desc, id desc
    ) as rn
  from public.financial_entries
)
delete from public.financial_entries
where id in (
  select id from ranked where rn > 1
);
