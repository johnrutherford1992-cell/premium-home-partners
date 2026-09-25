# Demo runbook

**Production URL: https://premium-home-partners.vercel.app**

Works on phones (390px and up) and desktop. The office console is best on a laptop.

## No login needed

The app opens on a launcher with one card per side:

| Card | Opens as | Lands on |
|---|---|---|
| **Homeowner app** | Elena Alvarez, 12 Linden Court, Mountain Brook | Home: today's visit with Marcus |
| **New customer** | A brand-new sign-up (see click path 5) | The sign-up page, then home setup |
| **Technician app** | Marcus Reyes | Today's route |
| **Vendor quote portal** | Sam Ortiz, Evergreen Outdoor Co. | Quote requests |
| **Office console** | Avery Brooks | Tier pricing |

- Tap a card and that side opens on live data, with no password. **‹ All apps** at the top of every side returns to the launcher, so you can move between sides at any time.
- Each browser tab stays on its own side, so you can run all four sides in four tabs of one browser.
- A side's address opens it directly, which is handy for bookmarks: `/homeowner`, `/tech`, `/vendor`, `/office`.

Under the hood, each side signs in to a seeded demo account. The launcher's **Sign in with email** link still takes these accounts, all with the password **`phpdemo2026`**: `homeowner@php.test`, `newhome@php.test`, `tech@php.test`, `vendor@php.test`, `office@php.test`.

## Before you present (5 minutes)

1. **Reset the data.** Open **Office console** and tap **Reset demo data** (bottom of the sidebar; on a phone it's the last item in the tab row). The toast "Demo data restored" confirms it.
   - Reset also runs automatically every morning at 4:07 AM Central, so the data is always dated today.
   - The visits are dated to the day the reset runs. If you reset the night before, reset again that morning.
2. **Set up one screen per side.** Suggested:
   - **Phone:** the production URL → **Homeowner app** (Elena).
   - **Laptop tabs:** `/tech` (Marcus), `/vendor` (Sam) and `/office` (Avery).
   - A second phone for Marcus also works.
3. **Warm up.** Open each side once and check that it loads. This also caches the fonts and each side's session, so switching later is instant.

## Click path

### 1. The homeowner's day (Elena, phone)
- Home shows **today, 9:00 – 11:00 AM**, with Marcus Reyes, the task list and the notice timeline.
- Tap **Confirm**. It shows "Confirmed ✓", and the office Dispatch row shows "· conf.".

### 2. The visit, live across devices (Marcus → Elena)
1. **Marcus:** Today's route → tap the **Elena Alvarez · 12 Linden Court** card → **Start driving · notify client**.
2. **Elena:** without a refresh, the banner reads **"Marcus is on the way · 12 min"**, and the Day-of notice lights up.
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

### 5. A new customer signs up (optional)
1. Launcher → **New customer**. The sign-up page opens with the kitchen photo and "Enjoy your home, not the hassle."
2. Enter a first and last name and an email (the phone is optional) → **Create my account**.
3. Home setup opens on step 1 with the name filled in. Enter an address, e.g. `45 Maple Ave, Homewood, AL 35209` → **Continue**.
4. **Scan serial plates:** tap the shutter five times. Each sample plate is read from the appliance cache and shows "Matched".
   - **Photo of a real plate** sends a photo to Claude vision. This needs the Anthropic workspace setting; see Health checks.
   - **Enter manually** always works.
5. **About the home** → **Build my plan**. Research streams to 100% from the server.
6. **Choose coverage** → **Start PHP Recommended**. You land on Home with the first visit booked.
7. **Marcus:** his route now includes the new customer, under the name you typed.

Each sign-up starts over: the previous new customer's home is cleared. Reset demo data restores the account to Jordan Lee.

## If the network fails: offline demo mode

On the **launcher**, turn on **Offline demo mode** (below the cards). All four apps then run on this one device, with sample data and no network needed.
- **Reset demo** on the offline launcher starts it over.
- **Exit offline demo** returns to the live launcher.

To force every visitor into offline mode, set `EXPO_PUBLIC_DEMO_MODE=1` in Vercel → Settings → Environment Variables and redeploy. Remove it to go live again.

If a side shows **"Too many attempts"**, wait a minute or use offline mode. Supabase allows about 30 password sign-ins per 5 minutes per network. Each tab signs in once per side and then reuses that session, so this only happens with many fresh tabs or devices on one Wi-Fi.

## Resetting

- **One tap:** Office → **Reset demo data**. Every open screen refreshes by itself.
- **SQL (Supabase dashboard → SQL editor):** `select seed_demo();`
- **Automatic:** daily at 04:07 Central (pg_cron job `php-daily-demo-reset`). To stop it: `select cron.unschedule('php-daily-demo-reset');`

Don't run the E2E suite during a demo. It resets the shared data.

## Health checks

- **App:** open the production URL; it should show the launcher with the Premium Home Partners logo.
- **Plate reading:** in the Supabase SQL editor, run
  `select net.http_get('https://ydsvmsitgkpunfnutdlo.supabase.co/functions/v1/lookup-appliance', headers := jsonb_build_object('Authorization','Bearer <anon key>'));`
  then `select content from net._http_response order by id desc limit 1;`.
  - `"ai":true` means the `ANTHROPIC_API_KEY` Edge Function secret is set.
  - `"workspace":true` means `ANTHROPIC_WORKSPACE_ID` is set too. The current key isn't scoped to a workspace, so real plate photos need it (or a workspace-scoped key). Without it, real photos fall back to manual entry; the five sample plates always work.
- **End-to-end tests:** GitHub Actions → **E2E** → Run workflow runs the full Playwright suite 3 times in a row against the live project. Set `base_url` to the production URL to test the deployed site.

## What is not production-ready

Everything shown in the click path above is backed by real data, row-level security and Realtime, and is covered by the end-to-end tests. These parts are not production-ready:

- **Accounts:** there is no real sign-up or login flow for customers. The launcher signs in to seeded demo accounts, and **New customer** reuses one seeded account (Jordan Lee) under the name you type. The email is checked but not stored. Only one new customer exists at a time.
  - Turn off "Allow new users to sign up" in Supabase → Authentication, since the app doesn't use it.
  - Leaked-password protection is off.
  - Set `EXPO_PUBLIC_DEMO_ACCESS=0` to go back to the email-and-password login.
- **Native apps:** there are no iOS or Android builds. The app runs on Expo, but only the web build was tested. The native camera screens and the navy splash screen (expo-splash-screen) need a new development build and have never run on a device.
- **Plate reading with AI** needs the `ANTHROPIC_WORKSPACE_ID` Edge Function secret (see Health checks).
- **Not built (P2):** push, email and SMS notices, the scheduled `send-notices` job, and Stripe checkout. "Start plan" activates the plan without payment.
- **Simulated:** network vendor bids (Summit Pro Services, Clearview & Sons are added automatically a few seconds after a request), the "12 min" ETA, route miles, and the map. Parts prices and suppliers are seeded sample data, and there is no live supplier pricing.
- **Visit schedule:** changing a plan's coverage tier updates the next visit's checklist but doesn't rebuild the rest of the year's visits. Seeded clients have only their next visit, and seeded visits can fall on a weekend.
- **One environment:** a single Supabase project serves the demo and the E2E tests, so there is no staging.
