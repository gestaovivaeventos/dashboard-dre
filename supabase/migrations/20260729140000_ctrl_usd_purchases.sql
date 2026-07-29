-- Compras em dólar nas requisições de Compras (CTRL).
--
-- O valor efetivo (ctrl_requests.amount) continua SEMPRE em BRL — é a fonte de
-- verdade para o lançamento no Omie, o desconto no orçamento e todo o trâmite.
-- Estes campos guardam apenas a ORIGEM em dólar (para auditoria e exibição):
-- valor em USD, câmbio usado e alíquota de IOF aplicada no momento da criação.
ALTER TABLE public.ctrl_requests
  ADD COLUMN IF NOT EXISTS usd_amount   numeric,
  ADD COLUMN IF NOT EXISTS usd_brl_rate numeric,
  ADD COLUMN IF NOT EXISTS iof_rate     numeric;

COMMENT ON COLUMN public.ctrl_requests.usd_amount IS
  'Valor original em dólar (US$) quando a compra foi feita em dólar. NULL = compra em reais. amount (BRL) é sempre a fonte de verdade.';
COMMENT ON COLUMN public.ctrl_requests.usd_brl_rate IS
  'Câmbio USD→BRL usado na conversão (dólar comercial do painel de IA), travado na criação.';
COMMENT ON COLUMN public.ctrl_requests.iof_rate IS
  'Alíquota de IOF (%) somada na conversão da compra em dólar.';

-- Alíquota de IOF (%) para compras em dólar, configurável no painel de IA (mesma
-- casa do câmbio USD→BRL). Default 3,5% (IOF de câmbio/cartão vigente em 2025).
ALTER TABLE public.ai_config
  ADD COLUMN IF NOT EXISTS usd_iof_rate numeric NOT NULL DEFAULT 3.5;

COMMENT ON COLUMN public.ai_config.usd_iof_rate IS
  'Alíquota de IOF (%) aplicada nas compras em dólar das requisições de Compras.';
