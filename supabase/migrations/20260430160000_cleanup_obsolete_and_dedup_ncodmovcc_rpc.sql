-- =============================================================================
-- RPCs SQL atomicas para o sync — substituem SELECTs em JS que sofriam do
-- limite default de ~1000 linhas do PostgREST (causa raiz das duplicatas
-- persistentes apos Full Sync em empresas com muitas linhas).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Limpa entries obsoletos: dado um array de omie_ids validos (gerados
--    pelo sync atual), apaga linhas de financial_entries da empresa que
--    NAO estao nesse conjunto. Opcionalmente limita por payment_date (modo
--    rolling/incremental); para mode='full', omite as datas (escopo total).
--
--    Substitui o SELECT id, omie_id ... + filter em JS no passo 5 do sync.
-- ---------------------------------------------------------------------------
create or replace function public.cleanup_obsolete_entries(
  p_company_id uuid,
  p_valid_omie_ids text[],
  p_date_from date default null,
  p_date_to date default null
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_deleted integer;
begin
  with deleted as (
    delete from public.financial_entries fe
    where fe.company_id = p_company_id
      and fe.omie_id <> all(p_valid_omie_ids)
      and (p_date_from is null or fe.payment_date >= p_date_from)
      and (p_date_to is null or fe.payment_date <= p_date_to)
    returning 1
  )
  select count(*)::integer into v_deleted from deleted;
  return v_deleted;
end;
$$;

grant execute on function public.cleanup_obsolete_entries(uuid, text[], date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Dedup por nCodMovCC para uma empresa especifica. Roda a cada sync para
--    consolidar duplicatas que persistirem (ex.: linhas no formato antigo
--    `mov:0:DATE:EXTP:VALUE` que ficaram fora do scan limitado em 1000).
--
--    Mantem a linha mais recente por (company_id, nCodMovCC, rateio_suffix).
-- ---------------------------------------------------------------------------
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
      substring(fe.omie_id from ':r[0-9]+$') as rateio_suffix
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

-- ---------------------------------------------------------------------------
-- 3) Limpeza one-shot global agora — para todas as empresas, ja que o
--    bug afeta todas que tem volume > 1000.
-- ---------------------------------------------------------------------------
select public.dedupe_financial_entries_by_ncodmovcc(null);
