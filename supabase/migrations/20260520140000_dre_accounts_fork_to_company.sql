-- Lazy-fork RPC for per-company DRE plans
-- Mirrors cash_flow_accounts_fork_to_company: clones the entire global DRE
-- plan into a company-scoped plan the first time an admin starts editing.
-- Idempotent: returns 0 and is a no-op if the company already has accounts.

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

  -- Two-pass insert keyed by code: first insert all rows with parent_id NULL
  -- (so the scope trigger validates each insert), then rewire parent_id by
  -- matching the source's parent code to the freshly-cloned row.
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

  RETURN v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dre_accounts_fork_to_company(uuid) TO authenticated;
