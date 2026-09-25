# Demo runbook

**Production URL: https://premium-home-partners.vercel.app**

Works on phones (390px and up) and desktop. The office console is best on a laptop.

## Logins

Every account uses the same password: **`phpdemo2026`**

| Role | Email | Who | Lands on |
|---|---|---|---|
| Homeowner | `homeowner@php.test` | Elena Alvarez, 12 Linden Court | Home: today's visit with Marcus |
| New homeowner | `newhome@php.test` | Jordan Lee (no home yet) | Onboarding |
| Technician | `tech@php.test` | Marcus Reyes | Today's route |
| Vendor | `vendor@php.test` | Sam Ortiz, Evergreen Outdoor Co. | Quote requests |
| Office | `office@php.test` | Avery Brooks | Tier pricing |

The login screen also has a **Demo accounts** card. Tap an account to fill in its email and password, then tap Sign in.

## Before you present (5 minutes)

1. **Reset the data.** Sign in as `office@php.test` and tap **Reset demo data** (bottom of the sidebar; on a phone it's under the tabs). The toast "Demo data restored" confirms it.
   - Reset also runs automatically every morning at 4:07 AM Central, so the data is always dated today.
   - The visits are dated to the day the reset runs. If you reset the night before, reset again that morning.
2. **Set up one screen per role.** Use one device, or one browser tab, per role. Each browser tab keeps its own sign-in, so you can run all four roles in four tabs of one browser. Suggested:
   - **Phone:** Elena (homeowner).
   - **Laptop tabs:** Marcus (tech), Sam (vendor), Avery (office).
   - A second phone for Marcus also works.
3. **Warm up.** Open each role once and check that it loads; this also caches the fonts.

## Click path

### 1. The homeowner's day (Elena, phone)
- Home shows **today, 9:00 – 11:00 AM**, with Marcus Reyes, the task list and the notice timeline.
- Tap **Confirm**. It shows "Confirmed ✓", and the office Dispatch row shows "· conf.".

### 2. The visit, live across devices (Marcus → Elena)
1. **Marcus:** Today's route → tap the **Elena Alvarez · 12 Linden Court** card → **Start driving · notify client**.
2. **Elena:** without a refresh, the blue banner reads **"Marcus is on the way · 12 min"**, and the Day-of notice lights up.
3. **Marcus:** **Mark arrived on site**. Elena's banner changes to **"Marcus is on site"** with a live task count.
4. **Marcus:** tick each checklist task. On *Replace HVAC filters ×2*, tap **+ Photo** and take a photo (on a laptop this opens a file picker). The pill shows "✓ Photo".
5. **Marcus:** **Complete & send report**. Elena's banner reads **"Visit complete · report ready"**.
6. **Elena:** Reports → the new report shows Home health 86, **the real photo**, and findings.

### 3. Add-on brokerage (Elena → Sam → Office)
1. **Elena:** Services → tap **Window washing**. The tile reads "Finding pros…", then network quotes arrive within a few seconds.
2. **Sam:** the request appears live under Quote requests. Open it, set a price and date, then **Submit quote**.
3. **Elena:** Evergreen Outdoor Co.'s bid appears live → **Book**.
4. **Office:** Add-on quotes shows the booking and the **coordination fee (10%)**. Sam's card reads **"Won · scheduled"**.

### 4. Pricing (Office → Elena)
1. **Elena:** open the **Plan** tab and note the monthly price.
2. **Office:** Pricing → tap **+** on **Labor rate $/hr** a few times. The tier cards update right away.
3. **Elena:** the Plan price updates without a refresh.

### 5. Onboarding a new home (optional, Jordan)
1. Sign in as `newhome@php.test` → **Set up my home**.
2. Enter a name and address → **Continue**.
3. **Scan serial plates:** tap the shutter five times. Each sample plate is read from the appliance cache and shows "Matched".
   - **Photo of a real plate** sends a photo to Claude vision. This needs the Anthropic key; see Health checks.
   - **Enter manually** always works.
4. **About the home** → **Build my plan**. Research streams to 100% from the server.
5. **Choose coverage** → **Start PHP Recommended**. You land on Home with the first visit booked.
6. **Marcus:** his route now includes Jordan Lee.

## If the network fails: offline demo mode

On the **login screen**, turn on **Offline demo mode**. You get the original all-in-one launcher: all four apps on this one device, with sample data and no network needed.
- **Reset demo** on the launcher starts it over.
- **Exit offline demo** returns to the login screen.

To force every visitor into offline mode, set `EXPO_PUBLIC_DEMO_MODE=1` in Vercel → Settings → Environment Variables and redeploy. Remove it to go live again.

## Resetting

- **One tap:** Office → **Reset demo data**. Every open screen refreshes by itself.
- **SQL (Supabase dashboard → SQL editor):** `select seed_demo();`
- **Automatic:** daily at 04:07 Central (pg_cron job `php-daily-demo-reset`). To stop it: `select cron.unschedule('php-daily-demo-reset');`

Don't run the E2E suite during a demo. It resets the shared data.

## Health checks

- **App:** open the production URL; it should show the login screen.
- **Plate reading:** in the Supabase SQL editor, run
  `select net.http_get('https://ydsvmsitgkpunfnutdlo.supabase.co/functions/v1/lookup-appliance', headers := jsonb_build_object('Authorization','Bearer <anon key>'));`
  then `select content from net._http_response order by id desc limit 1;`.
  `{"ok":true,"ai":true}` means the `ANTHROPIC_API_KEY` Edge Function secret is set.
- **End-to-end tests:** GitHub Actions → **E2E** → Run workflow runs the full Playwright suite 3 times in a row against the live project.

## What is not production-ready

Everything shown in the click path above is backed by real data, auth, row-level security and Realtime, and is covered by the end-to-end tests. These parts are not production-ready:

- **Native apps:** there are no iOS or Android builds. The app runs on Expo, but only the web build was tested. The native camera screens (expo-camera) typecheck and bundle but have never run on a device.
- **Plate reading with AI** needs the `ANTHROPIC_API_KEY` Edge Function secret. Without it, real plate photos fall back to manual entry. The five sample plates always read from the cache.
- **Not built (P2):** push, email and SMS notices, the scheduled `send-notices` job, and Stripe checkout. "Start plan" activates the plan without payment.
- **Simulated:** network vendor bids (Summit Pro Services, Clearview & Sons are added automatically a few seconds after a request), the "12 min" ETA, route miles, and the map. Parts prices and suppliers are seeded sample data, and there is no live supplier pricing.
- **Visit schedule:** changing a plan's coverage tier updates the next visit's checklist but doesn't rebuild the rest of the year's visits. Seeded clients have only their next visit, and seeded visits can fall on a weekend.
- **Auth:** email and password only, with seeded accounts. Phone OTP and self sign-up aren't built. Turn off "Allow new users to sign up" in Supabase → Authentication so nobody can create accounts through the API. Leaked-password protection is off.
- **One environment:** a single Supabase project serves the demo and the E2E tests, so there is no staging.
