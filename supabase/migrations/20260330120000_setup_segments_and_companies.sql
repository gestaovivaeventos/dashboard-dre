-- =============================================================================
-- 1. Rename "Real State" → "Real Estate" and update slug
-- =============================================================================
UPDATE public.segments
SET name = 'Real Estate', slug = 'real-estate'
WHERE slug = 'real-state';

-- =============================================================================
-- 2. Create all companies (skip if name already exists)
-- =============================================================================

-- Helper: insert company only if it doesn't exist by name
-- Uses ON CONFLICT DO NOTHING (requires unique constraint on name, otherwise
-- we use a conditional insert).

-- Franquias Viva
INSERT INTO public.companies (name, active)
SELECT v.name, true
FROM (VALUES
  ('Belo Horizonte'),
  ('Campo Grande'),
  ('Cuiaba'),
  ('Curitiba'),
  ('Hero Holding'),
  ('Juiz de Fora'),
  ('Petropolis'),
  ('Uberaba'),
  ('Viva Go'),
  ('Volta Redonda')
) AS v(name)
WHERE NOT EXISTS (
  SELECT 1 FROM public.companies c WHERE c.name = v.name
);

-- Feat
INSERT INTO public.companies (name, active)
SELECT v.name, true
FROM (VALUES
  ('Feat Producoes'),
  ('Case Shows'),
  ('Sirena'),
  ('Terrazzo')
) AS v(name)
WHERE NOT EXISTS (
  SELECT 1 FROM public.companies c WHERE c.name = v.name
);

-- Viva Company
INSERT INTO public.companies (name, active)
SELECT v.name, true
FROM (VALUES
  ('VE Franqueadora'),
  ('SPDX'),
  ('Dataforte')
) AS v(name)
WHERE NOT EXISTS (
  SELECT 1 FROM public.companies c WHERE c.name = v.name
);

-- Real Estate
INSERT INTO public.companies (name, active)
SELECT v.name, true
FROM (VALUES
  ('SGX'),
  ('Village'),
  ('Tamisa'),
  ('Brafaf'),
  ('Salvaterra Condominio')
) AS v(name)
WHERE NOT EXISTS (
  SELECT 1 FROM public.companies c WHERE c.name = v.name
);

-- Outros
INSERT INTO public.companies (name, active)
SELECT v.name, true
FROM (VALUES
  ('Spot'),
  ('Young Med')
) AS v(name)
WHERE NOT EXISTS (
  SELECT 1 FROM public.companies c WHERE c.name = v.name
);

-- =============================================================================
-- 3. Assign companies to segments (update segment_id based on name)
-- =============================================================================

-- Franquias Viva
UPDATE public.companies
SET segment_id = (SELECT id FROM public.segments WHERE slug = 'franquias-viva')
WHERE name IN (
  'Belo Horizonte', 'Campo Grande', 'Cuiaba', 'Curitiba', 'Hero Holding',
  'Juiz de Fora', 'Petropolis', 'Uberaba', 'Viva Go', 'Volta Redonda'
);

-- Also match existing names that might use accents or variations
UPDATE public.companies
SET segment_id = (SELECT id FROM public.segments WHERE slug = 'franquias-viva')
WHERE (
  name ILIKE '%petropolis%' OR name ILIKE '%petrópolis%'
  OR name ILIKE '%volta redonda%'
  OR name ILIKE '%belo horizonte%'
  OR name ILIKE '%campo grande%'
  OR name ILIKE '%cuiab%'
  OR name ILIKE '%curitiba%'
  OR name ILIKE '%hero holding%'
  OR name ILIKE '%juiz de fora%'
  OR name ILIKE '%uberaba%'
  OR name ILIKE '%viva go%'
)
AND segment_id IS DISTINCT FROM (SELECT id FROM public.segments WHERE slug = 'franquias-viva');

-- Feat
UPDATE public.companies
SET segment_id = (SELECT id FROM public.segments WHERE slug = 'feat')
WHERE name IN ('Feat Producoes', 'Case Shows', 'Sirena', 'Terrazzo')
  OR name ILIKE '%feat produ%';

-- Viva Company
UPDATE public.companies
SET segment_id = (SELECT id FROM public.segments WHERE slug = 'viva-company')
WHERE name IN ('VE Franqueadora', 'SPDX', 'Dataforte');

-- Real Estate
UPDATE public.companies
SET segment_id = (SELECT id FROM public.segments WHERE slug = 'real-estate')
WHERE name IN ('SGX', 'Village', 'Tamisa', 'Brafaf', 'Salvaterra Condominio')
  OR name ILIKE '%salvaterra%';

-- Outros
UPDATE public.companies
SET segment_id = (SELECT id FROM public.segments WHERE slug = 'outros')
WHERE name IN ('Spot', 'Young Med');
