-- =============================================================================
-- DIAGNOSTICO: entries afetados pelo bug de soma dobrada de juros/multa
-- =============================================================================
-- O bug (commit 3b261b3 ate c909879) aplicava `nValPago - desconto + juros +
-- multa` em baixas de RECEITA mesmo quando nValorMovCC > 0. Como em baixas
-- o nValPago do resumo JA reflete o cash liquido (com juros/multa), a formula
-- dobrava esses ajustes.
--
-- Este script identifica entries SUSPEITOS extraindo nJuros, nMulta, nDesconto
-- e nValorMovCC do raw_json e comparando com o valor armazenado. Mostra:
--   - Entries onde value > nValorMovCC (provavel dobra de juros/multa)
--   - Diferenca exata (provavel valor extra contado)
--   - Soma agregada por empresa para priorizar re-sync
--
-- Apenas SELECT, nao altera nada.
-- =============================================================================

with entries_extracted as (
  select
    fe.id,
    fe.company_id,
    fe.omie_id,
    fe.payment_date,
    fe.description,
    fe.value as valor_atual,
    coalesce((fe.raw_json ->> 'nJuros')::numeric, 0) as juros,
    coalesce((fe.raw_json ->> 'nMulta')::numeric, 0) as multa,
    coalesce((fe.raw_json ->> 'nDesconto')::numeric, 0) as desconto,
    coalesce((fe.raw_json ->> 'nValorMovCC')::numeric, 0) as valor_mov_cc
  from public.financial_entries fe
  where fe.type = 'receita'
),
suspects as (
  select
    e.*,
    -- Quando o bug aplicou a formula sobre o nValPago da baixa (que e o
    -- cash real), o resultado e: value = nValorMovCC + juros + multa - desconto
    -- Entao a diferenca esperada do bug e:
    (e.juros + e.multa - e.desconto) as diferenca_esperada_do_bug,
    (e.valor_atual - e.valor_mov_cc) as diferenca_real
  from entries_extracted e
  where e.valor_mov_cc > 0
    and (e.juros > 0 or e.multa > 0 or e.desconto > 0)
)
-- VISAO 1: Resumo agregado por empresa (priorize empresas com mais impacto)
select
  '=== RESUMO POR EMPRESA ===' as secao,
  c.name as empresa,
  count(*)::text as qtd_entries_suspeitos,
  to_char(sum(s.juros), 'FM999G999G990D00') as soma_juros,
  to_char(sum(s.multa), 'FM999G999G990D00') as soma_multa,
  to_char(sum(s.desconto), 'FM999G999G990D00') as soma_desconto,
  to_char(sum(s.valor_atual), 'FM999G999G990D00') as soma_valor_atual,
  to_char(sum(s.valor_mov_cc), 'FM999G999G990D00') as soma_valor_correto_movcc,
  to_char(sum(s.valor_atual) - sum(s.valor_mov_cc), 'FM999G999G990D00') as diferenca_total_estimada
from suspects s
join public.companies c on c.id = s.company_id
group by c.name
order by sum(s.valor_atual) - sum(s.valor_mov_cc) desc;

-- VISAO 2: Top 20 entries individuais por impacto
-- (rode separadamente se quiser ver os casos especificos)
/*
select
  c.name as empresa,
  s.payment_date,
  s.description,
  s.juros,
  s.multa,
  s.desconto,
  s.valor_mov_cc as valor_correto_movcc,
  s.valor_atual,
  (s.valor_atual - s.valor_mov_cc) as diferenca,
  s.omie_id
from suspects s
join public.companies c on c.id = s.company_id
where (s.valor_atual - s.valor_mov_cc) <> 0
order by abs(s.valor_atual - s.valor_mov_cc) desc
limit 20;
*/
