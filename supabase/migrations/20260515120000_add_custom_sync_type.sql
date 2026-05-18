-- Add 'custom' as a valid sync_type for manual syncs with a user-selected
-- date range (years/current-month checkboxes in Configuracoes).
ALTER TABLE public.sync_log
DROP CONSTRAINT sync_log_sync_type_check;

ALTER TABLE public.sync_log
ADD CONSTRAINT sync_log_sync_type_check
CHECK (sync_type IN ('incremental', 'full', 'rolling', 'custom'));
