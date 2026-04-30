-- =============================================================================
-- Limpeza one-shot de financial_entries duplicados originados pela geração
-- instável de omie_id em registros sem nCodTitulo (branches 2/3 de
-- makeOmieId em financial-processor.ts).
--
-- Problema: o omie_id antigo incluía `batchIndex` (posição do registro no
-- array da resposta da Omie). Como essa posição muda entre syncs,
-- o mesmo lançamento Omie ganhava omie_ids diferentes em syncs distintos,
-- gerando linhas duplicadas em financial_entries — visíveis como
-- duplicatas em diferentes meses/categorias na DRE.
--
-- O patch em financial-processor.ts torna o omie_id determinístico usando
-- (cNumTitulo, cOrigem, dDtPagamento, value) em vez de batchIndex.
--
-- Esta migration limpa as duplicatas já gravadas no banco. Para cada
-- conjunto de linhas que apontam para o MESMO lançamento Omie:
--   - Branch 1 (com nCodTitulo): chave (company_id, nCodTitulo, cNumParcela, cOrigem)
--   - Branches 2/3 (sem nCodTitulo): chave determinística estável
--     (company_id, cNumTitulo, cOrigem, payment_date, value).
-- Mantém a linha mais recente (created_at desc) e remove o restante.
-- =============================================================================

with raw_keys as (
  select
    fe.id,
    fe.company_id,
    fe.created_at,
    coalesce(
      fe.raw_json -> 'detalhes' ->> 'nCodTitulo',
      fe.raw_json ->> 'nCodTitulo'
    ) as nCodTitulo,
    coalesce(
      fe.raw_json -> 'detalhes' ->> 'cNumTitulo',
      fe.raw_json ->> 'cNumTitulo'
    ) as cNumTitulo,
    coalesce(
      fe.raw_json -> 'detalhes' ->> 'cNumParcela',
      fe.raw_json ->> 'cNumParcela'
    ) as cNumParcela,
    coalesce(
      fe.raw_json -> 'detalhes' ->> 'cOrigem',
      fe.raw_json ->> 'cOrigem'
    ) as cOrigem,
    fe.payment_date,
    fe.value,
    -- Sufixo de rateio (:r1, :r2, ...) faz parte da identidade lógica do entry,
    -- então preservamos para não fundir parcelas legítimas.
    substring(fe.omie_id from ':r[0-9]+$') as rateio_suffix
  from public.financial_entries fe
),
dedup_key as (
  select
    id,
    company_id,
    created_at,
    case
      when nCodTitulo is not null and nCodTitulo <> '' and nCodTitulo <> '0' then
        format(
          'b1|%s|%s|%s|%s|%s',
          company_id::text,
          nCodTitulo,
          coalesce(cNumParcela, ''),
          coalesce(cOrigem, ''),
          coalesce(rateio_suffix, '')
        )
      when cNumTitulo is not null and cNumTitulo <> '' then
        format(
          'b2|%s|%s|%s|%s|%s|%s',
          company_id::text,
          cNumTitulo,
          coalesce(cOrigem, ''),
          payment_date::text,
          to_char(value, 'FM999999999990.00'),
          coalesce(rateio_suffix, '')
        )
      else
        format(
          'b3|%s|%s|%s|%s|%s',
          company_id::text,
          coalesce(cOrigem, ''),
          payment_date::text,
          to_char(value, 'FM999999999990.00'),
          coalesce(rateio_suffix, '')
        )
    end as key
  from raw_keys
),
ranked as (
  select
    id,
    key,
    row_number() over (partition by key order by created_at desc, id desc) as rn
  from dedup_key
)
delete from public.financial_entries
where id in (
  select id from ranked where rn > 1
);
