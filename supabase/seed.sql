-- Demo data for Premium Home Partners (docs/LIVE_ARCHITECTURE.md §6).
-- Schema, reference-data upserts and the seeding functions live in
-- supabase/migrations/20260925000000_live.sql. Safe to run repeatedly.
--
--   ensure_demo_users(): the ten demo logins (password phpdemo2026) + profiles
--   seed_demo():         wipes transactional rows and rebuilds the scenario for
--                        "today" in America/Chicago (office "Reset demo" calls it)

select public.ensure_demo_users();
select public.seed_demo();
