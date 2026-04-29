-- Cleanup orphan __fundos_desp_* / __fundos_rec_* rows in category_mapping
-- and omie_categories that no longer have any financial_entries using them.
--
-- Context: pre-fix the Franquias Viva rule used category_mapping as one of the
-- detection sources, so codes like "1.04.98" or "2.08.96" (which mean "Estorno
-- de Pagamento" in some companies) were being redirected to __fundos_desp_*
-- and persisted as mappings pointing to 5.9. After the catalog-only fix
-- (sync.ts), those mappings stop being produced and the entries are reclassified
-- to their canonical code on the next sync, leaving the __fundos_* rows orphan.

-- 1. Remove orphan __fundos_*_X mappings (no financial_entries reference them).
delete from public.category_mapping cm
where (
    cm.omie_category_code like '__fundos_desp_%'
    or cm.omie_category_code like '__fundos_rec_%'
  )
  and not exists (
    select 1 from public.financial_entries fe
    where fe.category_code = cm.omie_category_code
      and (cm.company_id is null or fe.company_id = cm.company_id)
  );

-- 2. Remove orphan __fundos_*_X catalog rows (no financial_entries reference them).
delete from public.omie_categories oc
where (
    oc.code like '__fundos_desp_%'
    or oc.code like '__fundos_rec_%'
  )
  and not exists (
    select 1 from public.financial_entries fe
    where fe.category_code = oc.code
      and fe.company_id = oc.company_id
  );
