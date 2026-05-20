-- Per-company Cash Flow accounts
-- Mirrors the per-company DRE plan: each company can have its own
-- customized Cash Flow structure. Companies without a custom plan continue
-- to use the global plan (company_id IS NULL), preserving today's behavior
-- for every existing company and view.

ALTER TABLE public.cash_flow_accounts
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;

-- Replace the global UNIQUE on `code` with two partial unique indexes so the
-- same code can exist once globally and once per company.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cash_flow_accounts_code_key'
      AND conrelid = 'public.cash_flow_accounts'::regclass
  ) THEN
    ALTER TABLE public.cash_flow_accounts DROP CONSTRAINT cash_flow_accounts_code_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS cash_flow_accounts_global_code_idx
  ON public.cash_flow_accounts(code)
  WHERE company_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cash_flow_accounts_company_code_idx
  ON public.cash_flow_accounts(company_id, code)
  WHERE company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS cash_flow_accounts_company_idx
  ON public.cash_flow_accounts(company_id);

-- A child account must live in the same scope as its parent (both global,
-- or both belonging to the same company). Prevents per-company accounts
-- from attaching to the global tree and vice-versa.
CREATE OR REPLACE FUNCTION public.cash_flow_accounts_check_parent_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_company_id uuid;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT company_id INTO parent_company_id
  FROM public.cash_flow_accounts
  WHERE id = NEW.parent_id;

  IF parent_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'parent account scope mismatch: parent.company_id=% but new.company_id=%',
      parent_company_id, NEW.company_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cash_flow_accounts_parent_scope_trigger ON public.cash_flow_accounts;
CREATE TRIGGER cash_flow_accounts_parent_scope_trigger
  BEFORE INSERT OR UPDATE ON public.cash_flow_accounts
  FOR EACH ROW EXECUTE FUNCTION public.cash_flow_accounts_check_parent_scope();

-- Auto-compute `level` from `code` so the API does not need to send it
-- when creating new accounts.
CREATE OR REPLACE FUNCTION public.cash_flow_accounts_set_level()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.level := array_length(string_to_array(NEW.code, '.'), 1);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cash_flow_accounts_level_trigger ON public.cash_flow_accounts;
CREATE TRIGGER cash_flow_accounts_level_trigger
  BEFORE INSERT OR UPDATE OF code ON public.cash_flow_accounts
  FOR EACH ROW EXECUTE FUNCTION public.cash_flow_accounts_set_level();

-- Clone the entire global plan into a per-company plan. Used by the editor
-- when an admin starts customizing a company's structure.
CREATE OR REPLACE FUNCTION public.cash_flow_accounts_fork_to_company(p_company_id uuid)
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
  FROM public.cash_flow_accounts
  WHERE company_id = p_company_id;

  IF v_existing > 0 THEN
    RETURN 0;
  END IF;

  -- Two-pass insert keyed by code: first insert all rows with parent_id
  -- NULL (so trigger validates scope), then rewire parent_id by code.
  INSERT INTO public.cash_flow_accounts (
    code, name, parent_id, type, is_summary, formula, source,
    is_highlight_block, sort_order, active, company_id
  )
  SELECT
    g.code, g.name, NULL, g.type, g.is_summary, g.formula, g.source,
    g.is_highlight_block, g.sort_order, g.active, p_company_id
  FROM public.cash_flow_accounts g
  WHERE g.company_id IS NULL;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  UPDATE public.cash_flow_accounts child
  SET parent_id = parent.id
  FROM public.cash_flow_accounts source
  JOIN public.cash_flow_accounts parent
    ON parent.code = (
      SELECT g.code
      FROM public.cash_flow_accounts g
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

GRANT EXECUTE ON FUNCTION public.cash_flow_accounts_fork_to_company(uuid) TO authenticated;
