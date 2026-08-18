-- ============================================================================
-- Segregação do provedor de IA para LEITURA DE DOCUMENTOS (OCR).
--
-- Até aqui `ai_config.active_provider` valia para TUDO, e a leitura de boletos/
-- notas (visão) era forçada na OpenAI. Agora há um provedor DEDICADO ao OCR,
-- escolhido separadamente na tela de IA. Quando nulo, o OCR mantém o
-- comportamento anterior (OpenAI visão) — sem regressão.
-- ============================================================================

ALTER TABLE public.ai_config
  ADD COLUMN IF NOT EXISTS ocr_provider text;

-- Pré-cadastra o Google Gemini como opção de provedor (endpoint COMPATÍVEL com a
-- API da OpenAI). Modelo com visão, barato e bom em documentos brasileiros. A
-- chave fica VAZIA — o admin cola pela tela (Plataforma > IA).
INSERT INTO public.ai_provider_settings
  (provider, label, base_url, model, enabled, api_key_encrypted, updated_at)
VALUES
  ('gemini', 'Google Gemini',
   'https://generativelanguage.googleapis.com/v1beta/openai',
   'gemini-3.6-flash', true, NULL, now())
ON CONFLICT (provider) DO NOTHING;

-- Deixa o Gemini já selecionado como provedor de OCR. Passa a valer de fato
-- quando a chave for informada; sem chave, o resolver cai no comportamento
-- anterior (OpenAI visão), então nada quebra antes de configurar a chave.
UPDATE public.ai_config
  SET ocr_provider = 'gemini', updated_at = now()
  WHERE id = 1 AND ocr_provider IS NULL;
