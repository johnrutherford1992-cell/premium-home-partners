-- Demo safety net: re-seed the demo scenario every morning so "today's route"
-- and every visit date are current on presentation day, even if nobody taps
-- Reset demo data. Runs at 09:07 UTC (04:07 in Chicago during daylight time).
-- Skipped where pg_cron isn't available (the PGlite test harness).
-- Remove with: select cron.unschedule('php-daily-demo-reset');

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron not available; daily demo reset not scheduled';
    return;
  end if;
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.unschedule(jobid) from cron.job where jobname = 'php-daily-demo-reset';
  perform cron.schedule('php-daily-demo-reset', '7 9 * * *', 'select public.seed_demo()');
end
$$;
