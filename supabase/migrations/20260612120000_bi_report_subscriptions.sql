-- Assinaturas do relatorio mensal de Business Intelligence (One Page Report).
-- Cada linha vincula um usuario do sistema a UMA empresa: no dia 5 de cada mes
-- o cron /api/cron/monthly-bi-report gera o relatorio do mes anterior por
-- empresa e envia para os usuarios assinantes ativos.
--
-- Gestao: admin apenas (pagina /admin/relatorios-bi). O cron usa service-role
-- (bypassa RLS); as policies sao defesa em profundidade.

CREATE TABLE IF NOT EXISTS public.bi_report_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, company_id)
);

CREATE INDEX IF NOT EXISTS bi_report_subscriptions_company_idx
  ON public.bi_report_subscriptions(company_id) WHERE active;

ALTER TABLE public.bi_report_subscriptions ENABLE ROW LEVEL SECURITY;

-- Leitura: admin ou o proprio usuario (pra eventual tela "minhas assinaturas").
DROP POLICY IF EXISTS "Read bi_report_subscriptions" ON public.bi_report_subscriptions;
CREATE POLICY "Read bi_report_subscriptions"
ON public.bi_report_subscriptions
FOR SELECT
TO authenticated
USING (public.is_admin() OR user_id = auth.uid());

-- Escrita: admin apenas.
DROP POLICY IF EXISTS "Write bi_report_subscriptions admin" ON public.bi_report_subscriptions;
CREATE POLICY "Write bi_report_subscriptions admin"
ON public.bi_report_subscriptions
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());
