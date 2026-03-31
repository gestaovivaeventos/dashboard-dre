-- Add watermark column to companies
ALTER TABLE public.companies
ADD COLUMN last_full_sync_at timestamptz;

-- Add sync_type column to sync_log
ALTER TABLE public.sync_log
ADD COLUMN sync_type text NOT NULL DEFAULT 'full'
CHECK (sync_type IN ('incremental', 'full'));

-- For companies that already have financial_entries, set watermark to now()
-- so the next cron runs incremental instead of a full re-sync from 2022.
UPDATE public.companies
SET last_full_sync_at = NOW()
WHERE id IN (
  SELECT DISTINCT company_id FROM public.financial_entries
);
