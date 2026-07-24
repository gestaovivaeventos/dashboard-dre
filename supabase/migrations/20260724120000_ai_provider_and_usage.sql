-- Painel de IA: escolha de provedor (OpenAI / DeepSeek) + medição de consumo/custo.
--
-- Três objetos:
--   1. ai_config              — singleton (id=1): provedor ativo, câmbio USD→BRL e
--                               tabela de preços por modelo (jsonb, sobrescreve os
--                               defaults do código).
--   2. ai_provider_settings   — uma linha por provedor: habilitado, chave de API
--                               criptografada (AES-256-GCM, mesmo esquema do Omie)
--                               e o modelo padrão daquele provedor.
--   3. ai_usage_log           — um registro por chamada de IA: módulo, provedor,
--                               modelo, tokens e custo (USD + BRL).
--
-- As tabelas são lidas/escritas pelo servidor via service role (a RLS abaixo
-- nega anon/authenticated; o service role a ignora). Configurável em
-- /admin/ia (admin-only).

-- ─── ai_config (singleton) ──────────────────────────────────────────────────
create table if not exists public.ai_config (
  id             smallint primary key default 1,
  active_provider text not null default 'openai',
  usd_brl_rate   numeric not null default 5.50,
  -- { "gpt-4o-mini": {"input":0.15,"output":0.60}, ... } — USD por 1M tokens.
  -- Sobrescreve os defaults de DEFAULT_MODEL_PRICES (src/lib/ai/provider.ts).
  model_prices   jsonb not null default '{}'::jsonb,
  updated_at     timestamptz not null default now(),
  constraint ai_config_singleton check (id = 1)
);

insert into public.ai_config (id) values (1) on conflict (id) do nothing;

-- ─── ai_provider_settings (uma linha por provedor) ──────────────────────────
create table if not exists public.ai_provider_settings (
  provider          text primary key,          -- 'openai' | 'deepseek'
  enabled           boolean not null default true,
  api_key_encrypted text,                       -- null → usa a variável de ambiente
  model             text not null,
  updated_at        timestamptz not null default now()
);

insert into public.ai_provider_settings (provider, enabled, model) values
  ('openai',   true, 'gpt-4o-mini'),
  ('deepseek', true, 'deepseek-chat')
on conflict (provider) do nothing;

-- ─── ai_usage_log (um registro por chamada) ─────────────────────────────────
create table if not exists public.ai_usage_log (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  module        text not null,                  -- bi | relatorio_mensal | projecao | comparacao | contratos | ocr | viagens
  provider      text not null,                  -- openai | deepseek
  model         text not null,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  total_tokens  integer not null default 0,
  cost_usd      numeric not null default 0,
  cost_brl      numeric not null default 0,
  company_id    uuid,
  user_id       uuid,
  success       boolean not null default true,
  error_message text
);

create index if not exists ai_usage_log_created_at_idx on public.ai_usage_log (created_at desc);
create index if not exists ai_usage_log_module_idx on public.ai_usage_log (module);
create index if not exists ai_usage_log_provider_idx on public.ai_usage_log (provider);

-- ─── Funções de resumo (agregação para o painel) ────────────────────────────
-- Consumo agrupado por módulo/dia/provedor desde uma data (janela recente). O
-- dia é calculado no fuso de São Paulo (BRT) para bater com o negócio.
create or replace function public.ai_usage_summary(p_since timestamptz)
returns table (
  module        text,
  day           date,
  provider      text,
  input_tokens  bigint,
  output_tokens bigint,
  total_tokens  bigint,
  cost_usd      numeric,
  cost_brl      numeric,
  calls         bigint
)
language sql
stable
as $$
  select
    module,
    (created_at at time zone 'America/Sao_Paulo')::date as day,
    provider,
    sum(input_tokens)::bigint,
    sum(output_tokens)::bigint,
    sum(total_tokens)::bigint,
    sum(cost_usd),
    sum(cost_brl),
    count(*)::bigint
  from public.ai_usage_log
  where created_at >= p_since
  group by 1, 2, 3;
$$;

-- Totais acumulados (todo o histórico) por módulo/provedor.
create or replace function public.ai_usage_totals()
returns table (
  module       text,
  provider     text,
  total_tokens bigint,
  cost_usd     numeric,
  cost_brl     numeric,
  calls        bigint
)
language sql
stable
as $$
  select
    module,
    provider,
    sum(total_tokens)::bigint,
    sum(cost_usd),
    sum(cost_brl),
    count(*)::bigint
  from public.ai_usage_log
  group by 1, 2;
$$;

-- ─── RLS: trancado (só service role escreve/lê no servidor) ──────────────────
alter table public.ai_config            enable row level security;
alter table public.ai_provider_settings enable row level security;
alter table public.ai_usage_log          enable row level security;
-- Sem policies: anon/authenticated ficam sem acesso; o service role ignora a RLS.
