-- Remove legacy financial_entries created before the financial processor was implemented.
-- These entries have empty processing_metadata ({}) and use the old omie_id format
-- (without cOrigem suffix, e.g. "mov:123:001/001" instead of "mov:123:001/001:MANP").
-- The correct entries with full metadata already exist, so this only removes duplicates.

delete from public.financial_entries
where processing_metadata = '{}'::jsonb;
