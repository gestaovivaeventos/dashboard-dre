-- Painel de IA — parte 2:
--   1. Provedores dinâmicos: além de OpenAI/DeepSeek, o admin pode adicionar
--      qualquer provedor compatível com a API da OpenAI (Groq, Together,
--      OpenRouter, Mistral, etc.). Para isso guardamos rótulo (`label`) e a
--      base da API (`base_url`) por provedor.
--   2. Câmbio USD→BRL automático: `usd_brl_auto` liga a busca da cotação atual
--      do dólar comercial; `usd_brl_updated_at` registra quando foi atualizada.
--
-- Depende da migração 20260724120000 (que cria as tabelas). Aditiva e
-- idempotente. Configurável no Painel Administrador → Inteligência Artificial.

alter table public.ai_provider_settings
  add column if not exists label    text,
  add column if not exists base_url text;

-- Preenche os embutidos.
update public.ai_provider_settings set label = 'OpenAI'
  where provider = 'openai' and (label is null or label = '');
update public.ai_provider_settings set label = 'DeepSeek'
  where provider = 'deepseek' and (label is null or label = '');
update public.ai_provider_settings set base_url = 'https://api.deepseek.com'
  where provider = 'deepseek' and (base_url is null or base_url = '');
-- OpenAI usa a base padrão do SDK → base_url fica NULL.

alter table public.ai_config
  add column if not exists usd_brl_auto       boolean not null default true,
  add column if not exists usd_brl_updated_at timestamptz;
