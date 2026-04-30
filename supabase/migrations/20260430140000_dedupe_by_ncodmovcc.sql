-- =============================================================================
-- Limpeza definitiva de duplicatas em financial_entries via nCodMovCC.
--
-- Contexto:
-- A Omie devolve a mesma movimentacao bancaria em multiplos registros
-- (parent EXTP, baixa BAXP, conciliacao COMP, etc.) — historicamente cada
-- visao gerava um omie_id diferente, causando duplicatas no dashboard.
--
-- O codigo agora usa nCodMovCC (id da movimentacao em conta corrente) como
-- chave primaria do omie_id. nCodMovCC e o identificador mais granular e
-- estavel da Omie: UM movimento bancario real == UM nCodMovCC, independente
-- de quantos registros a API retorne para ele.
--
-- Esta migration:
-- 1. Apaga todas as linhas duplicadas que apontam para o mesmo nCodMovCC
--    dentro de uma empresa, mantendo a mais recente (created_at desc).
-- 2. Preserva o sufixo de rateio (:rN) — parcelas de rateio sao distintas
--    mesmo dentro do mesmo nCodMovCC.
-- 3. Linhas sem nCodMovCC no raw_json nao sao tocadas (nao ha como saber
--    se sao duplicatas pelo nCodMovCC).
-- =============================================================================

with extracted as (
  select
    fe.id,
    fe.company_id,
    fe.created_at,
    coalesce(
      fe.raw_json -> 'detalhes' ->> 'nCodMovCC',
      fe.raw_json ->> 'nCodMovCC'
    ) as n_cod_mov_cc,
    -- Rateio suffix (:r1, :r2, ...) faz parte da identidade logica do entry,
    -- pois cada parcela mapeia para uma categoria diferente.
    substring(fe.omie_id from ':r[0-9]+$') as rateio_suffix
  from public.financial_entries fe
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
)
delete from public.financial_entries
where id in (select id from ranked where rn > 1);
