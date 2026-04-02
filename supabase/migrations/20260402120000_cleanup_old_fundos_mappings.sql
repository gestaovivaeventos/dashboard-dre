-- Cleanup duplicate fundos mappings from old prefix format
-- Old: __fundos_receita_, __fundos_despesa_
-- New: __fundos_rec_, __fundos_desp_

DELETE FROM public.category_mapping
WHERE omie_category_code LIKE '__fundos_receita_%'
   OR omie_category_code LIKE '__fundos_despesa_%';

DELETE FROM public.omie_categories
WHERE code LIKE '__fundos_receita_%'
   OR code LIKE '__fundos_despesa_%';
