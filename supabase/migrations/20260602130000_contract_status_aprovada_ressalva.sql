-- Novo estado: "Aprovada com ressalva" — requisição aprovada, mas com uma
-- pendência que não reprova (ex.: contrato ≥ R$ 10k sem dados bancários no corpo;
-- futuramente: vencimento posterior à data prevista).
ALTER TYPE public.contract_item_status ADD VALUE IF NOT EXISTS 'aprovada_ressalva';
