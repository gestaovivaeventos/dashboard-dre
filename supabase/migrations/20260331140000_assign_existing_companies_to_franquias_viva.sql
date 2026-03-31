-- Assign all existing companies without a segment to "Franquias Viva"
UPDATE public.companies
SET segment_id = (SELECT id FROM public.segments WHERE slug = 'franquias-viva')
WHERE segment_id IS NULL;
