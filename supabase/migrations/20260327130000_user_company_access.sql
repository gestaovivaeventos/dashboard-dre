-- User-company access: allows users to access multiple companies
CREATE TABLE public.user_company_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, company_id)
);

CREATE INDEX user_company_access_user_id_idx ON public.user_company_access(user_id);
CREATE INDEX user_company_access_company_id_idx ON public.user_company_access(company_id);

ALTER TABLE public.user_company_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own company access"
  ON public.user_company_access FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin' AND active = true
  ));

CREATE POLICY "Admins can manage company access"
  ON public.user_company_access FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin' AND active = true
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin' AND active = true
  ));
