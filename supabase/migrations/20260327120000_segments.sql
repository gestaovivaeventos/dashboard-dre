-- Segments: fixed business segments for grouping companies
CREATE TABLE public.segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  display_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read segments"
  ON public.segments FOR SELECT
  TO authenticated
  USING (true);

-- Seed fixed segments
INSERT INTO public.segments (name, slug, display_order) VALUES
  ('Franquias Viva', 'franquias-viva', 1),
  ('Feat', 'feat', 2),
  ('Viva Company', 'viva-company', 3),
  ('Real State', 'real-state', 4),
  ('Outros', 'outros', 5);

-- User-segment access control
CREATE TABLE public.user_segment_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  segment_id UUID NOT NULL REFERENCES public.segments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, segment_id)
);

CREATE INDEX user_segment_access_user_id_idx ON public.user_segment_access(user_id);
CREATE INDEX user_segment_access_segment_id_idx ON public.user_segment_access(segment_id);

ALTER TABLE public.user_segment_access ENABLE ROW LEVEL SECURITY;

-- Admins can manage all access; users can read own access
CREATE POLICY "Users can read own segment access"
  ON public.user_segment_access FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin' AND active = true
  ));

CREATE POLICY "Admins can manage segment access"
  ON public.user_segment_access FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin' AND active = true
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin' AND active = true
  ));

-- Add segment_id to companies
ALTER TABLE public.companies ADD COLUMN segment_id UUID REFERENCES public.segments(id) ON DELETE SET NULL;
CREATE INDEX companies_segment_id_idx ON public.companies(segment_id);
