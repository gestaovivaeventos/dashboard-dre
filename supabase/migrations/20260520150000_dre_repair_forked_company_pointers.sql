-- Repair category_mapping pointers for companies whose DRE plan was forked
-- AFTER mappings were already in place. financial_entries does NOT store
-- dre_account_id directly — the dashboard resolves it at query time via a
-- JOIN with category_mapping (omie_category_code → dre_account_id).
--
-- Before fork: Hero's category_mapping rows pointed at GLOBAL dre_accounts.
-- After fork:  the dashboard scope filter loads only Hero's cloned accounts;
--              mappings that still point at global ids don't resolve to any
--              displayed account, so the value drops to zero.
--
-- Fix: for every company that has a custom DRE plan, rewrite any of its
-- category_mapping rows whose dre_account_id is a global account to the
-- equivalent cloned account (matched by code). Idempotent — does nothing
-- for rows already pointing at the cloned account.

UPDATE public.category_mapping cm
SET dre_account_id = c.id
FROM public.dre_accounts g
JOIN public.dre_accounts c
  ON c.company_id IS NOT NULL
 AND c.code = g.code
WHERE g.company_id IS NULL
  AND cm.dre_account_id = g.id
  AND cm.company_id = c.company_id;

-- Update the fork RPC to perform the same rewrite atomically as part of the
-- fork. Future forks will rewire the company's existing mappings in the
-- same transaction, so the dashboard keeps showing historical totals
-- without any manual remap.
CREATE OR REPLACE FUNCTION public.dre_accounts_fork_to_company(p_company_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_existing integer;
  v_inserted integer;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id is required';
  END IF;

  SELECT count(*) INTO v_existing
  FROM public.dre_accounts
  WHERE company_id = p_company_id;

  IF v_existing > 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO public.dre_accounts (
    code, name, parent_id, type, is_summary, formula,
    sort_order, active, company_id
  )
  SELECT
    g.code, g.name, NULL, g.type, g.is_summary, g.formula,
    g.sort_order, g.active, p_company_id
  FROM public.dre_accounts g
  WHERE g.company_id IS NULL;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  UPDATE public.dre_accounts child
  SET parent_id = parent.id
  FROM public.dre_accounts source
  JOIN public.dre_accounts parent
    ON parent.code = (
      SELECT g.code
      FROM public.dre_accounts g
      WHERE g.id = source.parent_id
    )
    AND parent.company_id = p_company_id
  WHERE source.company_id IS NULL
    AND source.parent_id IS NOT NULL
    AND child.company_id = p_company_id
    AND child.code = source.code;

  -- Rewire this company's existing category_mapping rows from global
  -- dre_account ids to the equivalent cloned ids. Without this, the
  -- dashboard's scope filter drops historical values to zero because the
  -- old mappings still resolve to accounts that aren't in the cloned plan.
  UPDATE public.category_mapping cm
  SET dre_account_id = c.id
  FROM public.dre_accounts g
  JOIN public.dre_accounts c
    ON c.company_id = p_company_id
   AND c.code = g.code
  WHERE g.company_id IS NULL
    AND cm.company_id = p_company_id
    AND cm.dre_account_id = g.id;

  RETURN v_inserted;
END;
$$;
