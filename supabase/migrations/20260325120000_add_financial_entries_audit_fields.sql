-- Adiciona campos de período para melhor auditoria e consolidação da DRE
-- Estes campos derivam de dDtPagamento e facilitam filtros e agregações

alter table public.financial_entries
add column if not exists ano_pgto integer,
add column if not exists mes_pagamento integer;

-- Cria índice para melhorar performance de filtros por período
create index if not exists financial_entries_periodo_idx
  on public.financial_entries(ano_pgto, mes_pagamento);

-- Adiciona coluna de metadata de processamento (JSON) para auditoria
alter table public.financial_entries
add column if not exists processing_metadata jsonb default '{}'::jsonb;

-- Cria índice para facilitar queries de auditoria
create index if not exists financial_entries_metadata_idx
  on public.financial_entries using gin (processing_metadata);
