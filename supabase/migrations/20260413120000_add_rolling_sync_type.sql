-- Add 'rolling' as a valid sync_type for the daily 3-day window cron
ALTER TABLE public.sync_log
DROP CONSTRAINT sync_log_sync_type_check;

ALTER TABLE public.sync_log
ADD CONSTRAINT sync_log_sync_type_check
CHECK (sync_type IN ('incremental', 'full', 'rolling'));
