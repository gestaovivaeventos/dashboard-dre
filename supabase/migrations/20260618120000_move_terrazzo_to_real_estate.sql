-- =============================================================================
-- Move company "Terrazzo" from segment "Feat" to segment "Real Estate".
--
-- This ONLY re-points companies.segment_id for the single company named
-- "Terrazzo". Every Terrazzo-specific rule is keyed on company name / company_id
-- (Google Sheets sync in src/lib/sheets/terrazzo-sync.ts, the data_source='sheets'
-- accounts from 20260609120000_terrazzo_sheets_accounts.sql, the
-- dre_sum_sheets_with_omie flag, category mappings, manual_account_values,
-- company_documents, budget, user_company_access, Omie sync data) — NONE of it
-- is gated on segment slug, so re-grouping the segment changes nothing about how
-- those rules behave. The company row itself is updated in place: no insert, no
-- delete, no recreate. Other companies are untouched.
-- =============================================================================

UPDATE public.companies
SET segment_id = (SELECT id FROM public.segments WHERE slug = 'real-estate')
WHERE name = 'Terrazzo'
  AND segment_id IS DISTINCT FROM (SELECT id FROM public.segments WHERE slug = 'real-estate');
