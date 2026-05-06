-- =============================================================================
-- Fix: dedupe_financial_entries_by_ncodmovcc nao reconhecia o sufixo de
-- rateio por DEPARTAMENTO no omie_id, deletando entries legitimas como se
-- fossem duplicatas.
--
-- Contexto:
-- A versao original (migration 20260430160000) extraia o sufixo de rateio
-- com o regex `:r[0-9]+$` — projetado para cobrir apenas rateio por
-- categoria (`:r1`..`:r5`). Quando passamos a explodir tambem por
-- departamento (financial-processor.ts), o omie_id passou a ter quatro
-- formatos:
--
--   1. `mov:cc:12345`               (sem rateio)
--   2. `mov:cc:12345:r1`            (rateio cat apenas — formato legado)
--   3. `mov:cc:12345:d1`            (rateio dept apenas — NOVO)
--   4. `mov:cc:12345:r1:d2`         (cat x dept — NOVO)
--
-- Os formatos 3 e 4 nao casavam com o regex antigo (que termina em `:rN`),
-- entao `rateio_suffix` virava NULL para todas as entries do mesmo
-- nCodMovCC com rateio dept. Particionando por (company_id, nCodMovCC,
-- coalesce(rateio_suffix, '')) elas caiam todas na MESMA particao e
-- `row_number > 1` deletava todas menos UMA — perdendo as demais partes
-- da rateacao.
--
-- Sintoma observado: empresas com rateio entre departamentos (ex.: Hero +
-- Viva Go compartilhando o mesmo aplicativo Omie) viam entries sumirem da
-- DRE de forma aparentemente aleatoria — alguns titulos rateados
-- preservavam todas as partes, outros perdiam quase tudo (dependia da
-- ordem de `created_at` na hora do dedup).
--
-- Fix: regex passa a capturar o sufixo COMPLETO ao final do omie_id
-- (`:rN`, `:dN` ou `:rN:dN`). Cada parte da rateacao mantem sufixo unico,
-- cai em particao propria e e preservada.
-- =============================================================================

create or replace function public.dedupe_financial_entries_by_ncodmovcc(
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
  with extracted as (
    select
      fe.id,
      fe.company_id,
      fe.created_at,
      coalesce(
        fe.raw_json -> 'detalhes' ->> 'nCodMovCC',
        fe.raw_json ->> 'nCodMovCC'
      ) as n_cod_mov_cc,
      -- Captura sufixo de rateio em qualquer combinacao: `:rN`, `:dN`,
      -- `:rN:dN`. Sem rateio, retorna NULL.
      substring(fe.omie_id from '(:r[0-9]+(:d[0-9]+)?|:d[0-9]+)$') as rateio_suffix
    from public.financial_entries fe
    where (p_company_id is null or fe.company_id = p_company_id)
  ),
  ranked as (
    select
      id,
      row_number() over (
        partition by company_id, n_cod_mov_cc, coalesce(rateio_suffix, '')
        order by created_at desc, id desc
      ) as rn
    from extracted
    where n_cod_mov_cc is not null
      and n_cod_mov_cc <> ''
      and n_cod_mov_cc <> '0'
  ),
  deleted as (
    delete from public.financial_entries
    where id in (select id from ranked where rn > 1)
    returning 1
  )
  select count(*)::integer into v_deleted from deleted;
  return v_deleted;
end;
$$;

grant execute on function public.dedupe_financial_entries_by_ncodmovcc(uuid) to authenticated;
