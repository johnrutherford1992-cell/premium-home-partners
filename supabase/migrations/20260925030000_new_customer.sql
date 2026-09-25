-- Premium Home Partners: "New customer" sign-up for the live demo.
-- Applies on top of 20260925020000_review_fixes.sql. Idempotent.
--
-- The demo has no real sign-up: the app's "New customer" card signs in to the
-- seeded onboarding account (Jordan Lee, newhome@php.test) and calls
-- start_new_customer(), which turns that account back into a brand-new
-- customer under the name the presenter typed. The onboarding flow then
-- starts from an empty home, exactly as it would for a real sign-up.
--
--   1. start_new_customer(p_full_name, p_phone): Jordan only. Deletes Jordan's
--      home and everything that hangs off it, then sets his name and phone.
--      Takes the same exclusive advisory lock as seed_demo, so it never
--      interleaves with a reset or with onboarding (save_home,
--      set_home_appliances and start_plan hold that lock shared).
--   2. ensure_demo_users() also clears the demo profiles' phone, so a reset
--      restores Jordan completely (name and phone). No demo account is seeded
--      with a phone. The rest of the function is unchanged from
--      20260925000000_live.sql.
--
-- Security advisors: start_new_customer joins the expected lint-0029 pattern
-- (a SECURITY DEFINER RPC that signed-in users can execute).

-- ---------------------------------------------------------------------------
-- 1. start_new_customer
-- ---------------------------------------------------------------------------

create or replace function public.start_new_customer(p_full_name text, p_phone text) returns void
  language plpgsql security definer set search_path = public
  as $$
declare
  u_jordan constant uuid := 'a0000000-0000-4000-8000-000000000006';
  v_name text := btrim(coalesce(p_full_name, ''));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_homes uuid[];
begin
  if auth.uid() is null then
    raise exception 'Please sign in again.' using errcode = 'P0001';
  end if;
  if auth.uid() <> u_jordan then
    raise exception 'You don''t have access to that.' using errcode = 'P0001';
  end if;
  if v_name = '' then
    raise exception 'Enter your name.' using errcode = 'P0001';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'Use a name of 80 characters or fewer.' using errcode = 'P0001';
  end if;
  if v_phone is not null and char_length(v_phone) > 30 then
    raise exception 'Check the phone number and try again.' using errcode = 'P0001';
  end if;

  -- Same lock as seed_demo (exclusive): no reset or onboarding RPC runs meanwhile.
  perform pg_advisory_xact_lock(hashtextextended('php:demo-data', 0));

  v_homes := array(select id from homes where owner_id = u_jordan);

  -- Children first, in seed_demo's order (WHERE clauses keep safeupdate happy).
  delete from quote_bookings
  where request_id in (select id from quote_requests where home_id = any (v_homes));
  delete from bids
  where request_id in (select id from quote_requests where home_id = any (v_homes));
  delete from quote_requests where home_id = any (v_homes);
  delete from reports
  where visit_id in (select id from visits where home_id = any (v_homes));
  delete from visit_photos
  where visit_task_id in (select t.id from visit_tasks t join visits v on v.id = t.visit_id
                          where v.home_id = any (v_homes));
  delete from notices
  where visit_id in (select id from visits where home_id = any (v_homes));
  delete from visit_tasks
  where visit_id in (select id from visits where home_id = any (v_homes));
  delete from visits
  where home_id = any (v_homes)
     or plan_id in (select id from plans where home_id = any (v_homes));
  delete from plans where home_id = any (v_homes);
  delete from plan_builds where home_id = any (v_homes);
  delete from appliances where home_id = any (v_homes);
  delete from homes where id = any (v_homes);

  update profiles set full_name = v_name, phone = v_phone where id = u_jordan;
end $$;

revoke execute on function public.start_new_customer(text, text) from public, anon;
grant execute on function public.start_new_customer(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. ensure_demo_users: also restore the (empty) phone
-- ---------------------------------------------------------------------------

-- Creates the demo logins (password phpdemo2026) and their profiles. Idempotent.
create or replace function public.ensure_demo_users() returns void
  language plpgsql security definer set search_path = public
  as $$
declare
  v_col text;
  v_ids uuid[] := array(select id from private.demo_users());
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000'::uuid, u.id, 'authenticated', 'authenticated', u.email,
         extensions.crypt('phpdemo2026', extensions.gen_salt('bf')), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', u.full_name),
         now(), now()
  from private.demo_users() u
  where not exists (select 1 from auth.users a where a.id = u.id or lower(a.email) = lower(u.email))
  on conflict do nothing;

  -- GoTrue scans these as strings; NULL breaks sign-in.
  foreach v_col in array array['confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change',
                               'phone_change', 'phone_change_token', 'email_change_token_current',
                               'reauthentication_token'] loop
    if exists (select 1 from information_schema.columns
               where table_schema = 'auth' and table_name = 'users' and column_name = v_col) then
      execute format('update auth.users set %1$I = '''' where %1$I is null and id = any ($1)', v_col) using v_ids;
    end if;
  end loop;

  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select u.id::text, u.id,
         jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
         'email', now(), now(), now()
  from private.demo_users() u
  where exists (select 1 from auth.users a where a.id = u.id)
  on conflict do nothing;

  -- handle_new_user created homeowner profiles; set the real roles and details.
  -- The phone is cleared too: start_new_customer sets Jordan's, and none is seeded.
  insert into profiles (id, role, full_name, email, title, vehicle, phone)
  select u.id, u.role, u.full_name, u.email, u.title, u.vehicle, null
  from private.demo_users() u
  where exists (select 1 from auth.users a where a.id = u.id)
  on conflict (id) do update
  set role = excluded.role, full_name = excluded.full_name, email = excluded.email,
      title = excluded.title, vehicle = excluded.vehicle, phone = null;
end $$;

-- Seeding: database owner (and service role) only (restated after the replace).
revoke execute on function public.ensure_demo_users() from public, anon, authenticated;
