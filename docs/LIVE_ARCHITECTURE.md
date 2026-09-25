# Live architecture (Supabase + auth + realtime)

This is the contract for taking the app from the single-device demo store to a
real multi-user backend. Every screen keeps the Concierge Mist visuals exactly
as they are: same tokens, fonts, components, copy and layout. Only the data
behind them changes.

Principles, in priority order:

1. **Nothing breaks on stage.** Every data screen has loading, empty and error
   states. Errors show a friendly message and a Retry, never a blank screen or
   a raw error. Every button either does something or is visibly disabled.
2. **Server-enforced rules.** All homeowner, tech and vendor writes go through
   `security definer` RPCs that check role and ownership. Clients get read-only
   RLS (office can also write pricing tables directly).
3. **Realtime is an accelerator, polling is the floor.** Realtime events only
   *invalidate* React Query caches. Every query also polls (15 s when realtime
   is healthy, 3 s when it isn't), so a dropped socket degrades to "a few
   seconds late", never "stuck".
4. **Offline demo mode survives.** The original zustand store keeps working
   behind a clearly labeled toggle, with the same screens.

---

## 1. Modes

`src/lib/mode.ts` exports `useMode()` (zustand, persisted in AsyncStorage under
`php-mode-v1`):

```ts
type Mode = 'live' | 'demo';
useMode(): { mode: Mode; hydrated: boolean; forced: boolean; setMode(m: Mode): void }
```

- `forced` is true, and `mode` is always `'demo'`, when Supabase isn't
  configured (no `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`) or
  when `EXPO_PUBLIC_DEMO_MODE=1`.
- The default is `'live'` when Supabase is configured.
- The root layout renders a blank field-colored view until `hydrated`, then
  keys the whole tree on `mode`. Switching modes remounts everything, so data
  hooks may pick their live or demo implementation once per mount:
  `const useImpl = mode === 'live' ? useLiveX : useDemoX; return useImpl();`

**Demo mode** is today's app: the launcher at `/`, every role reachable, and
the shared zustand store. The launcher shows an `OFFLINE DEMO` badge. If
Supabase is configured, it also shows a ghost button, "Exit offline demo",
which returns to `/login`.

**Live mode** needs a signed-in user and routes by `profiles.role`.

## 2. Auth and routing

Supabase Auth with **email + password** (no email delivery, so it's reliable
on stage). Sign-ups are not exposed in the UI; accounts are seeded.

`src/lib/auth.tsx`:

```ts
<SessionProvider>            // mounted in live mode only
useSession(): {
  status: 'loading' | 'signedOut' | 'signedIn';
  userId: string | null;
  profile: { id: string; role: 'homeowner'|'tech'|'vendor'|'office'; fullName: string } | null;
  signIn(email: string, password: string): Promise<{ error?: string }>; // friendly messages
  signOut(): Promise<void>;
}
```

Routes:

| Path | Live mode | Demo mode |
|---|---|---|
| `/` | signed out → `/login`; signed in → `ROLE_HOME[role]` | launcher (unchanged) |
| `/login` | sign-in screen | redirect to `/` |
| `/homeowner`, `/tech`, `/vendor`, `/office` | guarded by `<RoleGate role=…>` in each role `_layout.tsx` | unguarded |

`ROLE_HOME = { homeowner: '/homeowner', tech: '/tech', vendor: '/vendor', office: '/office' }`.

`<RoleGate role>` (in `src/components/RoleGate.tsx`): in demo mode it renders
its children. In live mode it shows a blank field while loading, sends signed-out
users to `/login` and wrong-role users to their own `ROLE_HOME`, and renders
children for the matching role.

**Login screen** (`src/app/login.tsx`), built only from existing primitives
inside `<Screen>`: the `PREMIUM HOME PARTNERS` eyebrow (mono, accent), a
Display headline "Welcome back.", email and password fields styled exactly like
the onboarding `Field`, and a full-width primary `LqButton` "Sign in" that is
disabled while submitting and shows "Signing in…". Errors appear as brick-colored
13px text, e.g. "That email and password don't match." or "Can't reach the
server. Check your connection or switch to offline demo mode." Below that:

- a **Demo accounts** card (hidden when `EXPO_PUBLIC_SHOW_DEMO_ACCOUNTS=0`)
  listing the five accounts as tappable rows that fill in the email and
  password;
- a row with a `Toggle` for **Offline demo mode**, which calls `setMode('demo')`
  and goes to `/`;
- a ghost "Dark mode" / "Light mode" button, the same as on the launcher.

**"‹ All apps" links.** In demo mode they stay as they are. In live mode the
same `TextLink` reads "Sign out" and signs out. Use
`<AppExitLink />` from `src/components/AppExitLink.tsx` everywhere a screen has
"‹ All apps" today.

## 3. Data layer

`@tanstack/react-query` v5 with one `QueryClient` (`src/lib/queryClient.ts`):

```ts
defaultOptions.queries = { retry: 2, staleTime: 2_000, refetchOnWindowFocus: true,
  refetchInterval: () => (realtimeHealthy() ? 15_000 : 3_000) }
```

**Query conventions (required):**

- Every live query declares the tables it reads:
  `meta: { tables: ['visits', 'visit_tasks'] }`
- Query keys start with the role or domain, e.g. `['homeowner', 'nextVisit', userId]`.
- After every successful RPC, call `invalidateTables([...])` from
  `src/lib/realtime.tsx`. That refetches every query whose `meta.tables`
  intersects, so the actor's own UI updates instantly without waiting for
  Realtime.
- Supabase errors are never shown raw. `friendlyError(e)` in `src/lib/rpc.ts`
  maps them: network errors → "Can't reach the server. Retrying…", RLS or
  permission errors → "You don't have access to that.", and the RPC exception
  messages below (raised with `errcode 'P0001'`) are already written for users
  and pass through.
- `rpc<T>(fn, args)` in `src/lib/rpc.ts` wraps `supabase.rpc`: it throws an
  `Error(friendlyError(e))` and returns `data as T`.

**Realtime bridge** (`src/lib/realtime.tsx`, `<RealtimeBridge/>` mounted while
signed in): one channel subscribed to `postgres_changes` (`event: '*'`,
`schema: 'public'`) for every table in §5. On each event it calls
`invalidateTables([event.table])`. It tracks the channel status and exports:

- `realtimeHealthy(): boolean`, true only while the channel is `SUBSCRIBED`;
- `useRealtimeStatus(): 'connecting' | 'live' | 'offline'`.

On `CHANNEL_ERROR`, `TIMED_OUT` or an unexpected `CLOSED` it resubscribes with backoff (1 s, 2 s, 4 s,
capped at 10 s). On sign-in or out it tears down and rebuilds, so RLS uses the
new JWT.

**Screen states** (`src/components/States.tsx`), all built from existing
primitives:

- `<LoadingState label?="Loading…" />`: an LqCard with a pulsing muted line;
- `<ErrorState message onRetry />`: an LqCard with a 600-weight title, a muted
  message and a ghost `LqButton` "Try again";
- `<EmptyState title body />`: an LqCard, the same shape as the existing "No
  requests yet" card.

**Toasts** (`src/lib/toast.tsx`): `toast(message, tone?: 'neutral'|'forest'|'brick')`
shows a glass pill at the bottom for 3 s. Use it for mutation errors and for
confirmations like "Demo data restored".

**Dates** (`src/lib/dates.ts`), always in `America/Chicago`:

- `fmtDay(iso)` → `'Fri · Sep 25'`
- `fmtWindow(startIso, endIso)` → `'9:00 – 11:00 AM'`, or `'11:00 AM – 1:00 PM'`
  when the window crosses noon
- `fmtShortDate('2026-10-18')` → `'Sun, Oct 18'`
- `fmtMonth(iso)` → `'Oct'`
- `weekOfLabel(date)` → `'WEEK OF SEP 21'` (Monday of that week)
- `todayChicago()` → `'YYYY-MM-DD'`
- `addDays('YYYY-MM-DD', n)` → `'YYYY-MM-DD'`

### Shared hooks (spine)

`src/data/pricing.ts`:

```ts
interface PricingInputs { settings: PricingSettings; mins: LaborMinutes; freq: Frequencies; coordinationFee: number }
usePricingInputs(): { data?: PricingInputs; isLoading; error; refetch }   // live: pricing_settings + task_defaults, meta.tables both; demo: from zustand
toTierViews(quotes: TierQuote[]): TierView[]   // the exact formatting in store/derived.ts (moved here, derived.ts re-exports)
useOfficePricingMutations(): {
  setSetting(k: 'rate'|'trip'|'markup'|'techCost', value: number): void;   // optimistic setQueryData, debounced 250 ms write of the absolute value
  setMinutes(taskKey: string, value: number): void;
  setFreq(taskKey: string, tierIndex: number, value: number): void;
}
```

The DB stores `parts_markup` as a fraction (0.25). The app uses percent (25);
convert both ways here. Office writes go directly to `pricing_settings`
(`update … where id = 1`) and `task_defaults`, which the office RLS allows.

`src/data/visits.ts`:

```ts
interface TaskVM { id; key; name; short; part; min: number; done: boolean;
  photoKind: 'before'|'after'|'drain';                // from TASKS[].photo: dirty→before, clean→after, ice→after, drain→drain
  photos: { id: string; kind: string; path: string }[] }
interface TechVM { id; name; firstName; initials; title; van }
interface VisitVM {
  id; homeId; status: 'scheduled'|'enroute'|'onsite'|'done'; confirmed: boolean;
  windowStart; windowEnd; day: string; time: string; duration: string;   // duration like '3 hr 5 min'
  client: { name; firstName; street; address; pets: boolean; notes: string };
  tierIndex: number; tierName: string;
  tech: TechVM | null;
  tasks: TaskVM[]; doneCount: number;
  notices: { d7: boolean; h48: boolean; dayOf: boolean; report: boolean };
  reportId: string | null;
}
VISIT_SELECT: string            // PostgREST select that embeds everything above
VISIT_TABLES = ['visits','visit_tasks','visit_photos','notices','reports','homes','plans','profiles']
mapVisit(row, mins: LaborMinutes): VisitVM
```

`street` is `address.split(',')[0]`. `client.name` is the home owner's
`profiles.full_name`. Tech `title` and `van` come from `profiles.title` and
`profiles.vehicle`.

### Per-role hooks (each role agent owns `src/data/<role>.ts`)

Each role file exports mode-dispatching hooks with live **and** demo
implementations. The demo implementation adapts the existing zustand store and
`store/derived.ts`, so demo mode behaves exactly as it does today.

- **homeowner.ts**: `useMyHome()` (home, profile name, active plan tier,
  onboarded flag), `useHomeownerTiers()` (`{ tiers, cur }`, live from
  `usePricingInputs` + home pets/water + plan tier), `useCurrentVisit()`
  (`VisitVM | null`), `useYearOfCare()`, `useReports()`,
  `useQuoteRequests()`, plus mutations `confirmVisit`, `rescheduleVisit`,
  `setTier`, `requestQuote(category)`, `bookBid(bidId)`, and onboarding
  mutations `saveHome`, `setAppliances`, `buildPlan`, `startPlan`.
- **tech.ts**: `useTechRoute()` and `useTechVisit(id)`, plus `advanceVisit`,
  `setTaskDone`, `addPhoto`, `completeVisit`.
- **vendor.ts**: `useVendorMe()`, `useVendorRequests()`, `useVendorRequest(id)`,
  and `submitBid`.
- **office.ts**: `useDispatch()`, `useOfficeQuotes()`, `sendReminders`,
  `resetDemo`.

"Current visit" for a homeowner means the earliest visit by `window_start`
that is either not `done`, or is `done` with `window_end` at or after the start
of today in Chicago.

"Tech route" is the tech's visits that are either not `done` or start today or
later, ordered by `window_start`. The first non-done visit is the active job.

## 4. Database changes (`supabase/migrations/20260925000000_live.sql`)

On top of `20260924000000_init.sql`:

**Columns**

- `profiles`: `email text`, `title text`, `vehicle text`
- `homes`: `notes text` (client notes, e.g. "Gate code 4471. Heater in garage, back left.")
- `appliance_models`: `name text` ("Carrier Infinity furnace"), `note text` ("Filter 16×25×4")
- `plan_builds`: `step text`, `summary jsonb`, `error text`, `updated_at timestamptz default now()`
- `visits`: `offered_slots jsonb` (array of `{"start": iso, "end": iso}`), `started_at`, `arrived_at`, `completed_at timestamptz`
- `quote_requests`: `area text` (e.g. "12 Linden Court · Dallas 75205", no owner name), `home_sqft int`, `base numeric(10,2)`, `bid_count int not null default 0`
- new table `quote_bookings(request_id pk, bid_id, coordination_fee numeric(10,2), booked_at)`: the booking money, readable only by the request's owner and office (vendors can't derive a rival's price from the fee)
- `bids`: `vendor_name text`, `vendor_rating numeric(2,1)`, both copied from `vendors` by a `before insert` trigger
- new table `service_categories(id text pk, name text, sub text, base numeric)`, seeded with the six add-ons from `apps/mobile/src/data/seed.ts` (`lawn, land, win, press, lights, tree`). Readable by any signed-in user.
- partial unique index: one active request per home and category, `unique (home_id, category) where status in ('open','booked')`
- trigger: `bids` insert/delete keeps `quote_requests.bid_count` in sync

**RLS changes.** Every client write goes through an RPC, so these become select-only:

- drop `owner_confirm` on visits, and make `tech_visits`, `tech_visit_tasks`,
  `tech_photos`, `owner_requests`, `vendor_bids`, `owner_homes` and
  `owner_appliances` select-only
- `profiles`: add `owner_sees_tech` (a homeowner reads the profile of any tech
  assigned to their visits) and `tech_sees_clients` (a tech reads the owner
  profile of homes on their visits). A vendor reads **no** homeowner profile.
- `notices`: add `owner_notices` (select for the owner's visits) and
  `tech_notices` (select for the tech's visits)
- `plans`: add `tech_plans` (select for plans of homes on the tech's visits)
- `service_categories`: select for any signed-in user
- the vendor never reads `homes` or `profiles`. It gets the location only from
  `quote_requests.area` and `home_sqft`.

**Storage** (bucket `visit-photos`, private), with paths
`{visit_id}/{task_id}/{kind}-{epoch_ms}.jpg`:

- insert: the tech assigned to the visit in `(storage.foldername(name))[1]`
- select: that tech, the home's owner, and office

**Realtime publication**: the existing `visits, visit_tasks, quote_requests,
bids, plan_builds` plus `pricing_settings, task_defaults, reports,
visit_photos, notices, quote_bookings`.

Vendors see a quote request only while it is open or once they have bid on it
(`supabase/migrations/20260925020000_review_fixes.sql`).

### RPC catalog

All RPCs are `security definer set search_path = public`, granted to
`authenticated` only, and raise user-facing messages with
`raise exception '…' using errcode = 'P0001'`.

| RPC | Who | Behavior |
|---|---|---|
| `confirm_visit(p_visit uuid) returns void` | owner | `confirmed_at = now()` |
| `reschedule_visit(p_visit uuid) returns visits` | owner | only while `status = 'scheduled'`; moves the window to the next entry of `offered_slots` (cyclic) and clears `confirmed_at`. Error: "This visit can't be rescheduled once the technician is on the way." |
| `advance_visit(p_visit uuid) returns visits` | assigned tech or office | `scheduled → enroute` (sets `started_at`, inserts notice `enroute`/`push`) → `onsite` (sets `arrived_at`). Any other state: "This visit is already on site." |
| `set_task_done(p_task uuid, p_done boolean) returns visit_tasks` | assigned tech | only while the visit is `onsite`. Sets `done` and `done_at`. Error: "Mark yourself on site to start the checklist." |
| `add_visit_photo(p_task uuid, p_kind text, p_path text) returns visit_photos` | assigned tech | the visit must be `onsite` or `done`, and the path must start with `{visit_id}/` |
| `complete_visit(p_visit uuid) returns reports` | assigned tech | the visit must be `onsite` with every task done. Sets `status = 'done'` and `completed_at`, inserts the report (`health_score` 86, and `findings` `[{"text":"Anode rod 70% depleted","tone":"ochre","badge":"Quote $185"},{"text":"Dryer vent airflow normal","tone":"forest","badge":"Good"}]` when the home has a water heater or dryer, else `[]`), and inserts notice `report`/`push`. Idempotent: a second call returns the existing report. |
| `request_quote(p_category text) returns quote_requests` | homeowner with a home | idempotent. If the home already has an open or booked request for that category, return it. Otherwise insert one with `scope` and `base` from `service_categories`, `area` = street · city ZIP, and `home_sqft`. |
| `submit_bid(p_request uuid, p_price numeric, p_available_on date) returns bids` | vendor | the caller's vetted vendor row must include the category and the request must be open. Errors: "This request is closed." and "Enter a price above $0." One bid per vendor: a repeat call returns the existing bid. |
| `book_bid(p_bid uuid) returns quote_requests` | owner | the request must be open (first booking wins): `status = 'booked'`, `booked_bid_id`, and a `quote_bookings` row with `coordination_fee = round(price * pricing_settings.coordination_fee, 2)`. Error: "This request was already booked." |
| `send_48h_reminders() returns int` | office | inserts notice `48h`/`push` for every visit in the next 7 days that isn't done and has no `48h` notice yet; returns the count |
| `set_plan_tier(p_tier tier_key, p_monthly numeric, p_annual numeric, p_materials numeric, p_labor numeric, p_next_tasks text[]) returns plans` | owner | updates the active plan. If the current visit is still `scheduled` with no tasks done, replaces its `visit_tasks` with `p_next_tasks`, taking names from `task_defaults`. |
| `save_home(p_full_name text, p_address text, p_sqft int, p_year int, p_beds numeric, p_baths numeric, p_floors int, p_zones int, p_pets boolean, p_water text) returns homes` | homeowner | upserts the caller's single home and sets `profiles.full_name` |
| `set_home_appliances(p_home uuid, p_items jsonb) returns int` | owner | replaces the home's appliances. Items look like `{model, serial, brand, name}`; `model_id` is resolved from `appliance_models.model` when it exists. |
| `start_plan(p_home uuid, p_tier tier_key, p_monthly numeric, p_annual numeric, p_materials numeric, p_labor numeric, p_schedule jsonb) returns plans` | owner | deactivates old plans and inserts the plan. `p_schedule` is `[{"month_offset": 0, "task_keys": ["hvac", …]}, …]`, from `buildSchedule`. Creates one visit per entry, 9–11 AM Chicago time: the first on the next weekday, later ones at `+month_offset` months (moved to a weekday). Assigns the default tech (Marcus). Fills `offered_slots` for the first visit (its own slot, next weekday +1 1–3 PM, +3 weekdays 8–10 AM), inserts `visit_tasks`, and inserts a `7d`/`email` notice for the first visit. |
| `reset_demo() returns void` | office | `perform seed_demo()` |

`seed_demo(p_today date default (now() at time zone 'America/Chicago')::date)`
is **not** granted to clients; `supabase/seed.sql` runs `select seed_demo();`.
It deletes every row in the transactional tables (quote requests, bids,
reports, photos, visit tasks, visits, plans, plan builds, notices, appliances,
homes), resets `pricing_settings` and `task_defaults` to the `PRICING.md`
defaults, and recreates the scenario in §6. It never deletes auth users.

`ensure_demo_users()` is idempotent (`on conflict do nothing`). It creates the
§6 users in `auth.users` + `auth.identities` with
`extensions.crypt(pw, extensions.gen_salt('bf'))`, `email_confirmed_at = now()`,
and empty strings (not null) for `confirmation_token`, `recovery_token`,
`email_change_token_new` and `email_change`. It then upserts their `profiles`
with the right `role`, `full_name`, `email`, `title` and `vehicle`.

## 5. Edge functions

All require a JWT (`verify_jwt = true`) and return JSON. They share
`supabase/functions/_shared/pricing.ts`, a byte-for-byte copy of
`packages/pricing/src/index.ts` kept in sync by `npm run sync:pricing` and
checked by a test.

- **build-plan**: `POST { home_id }`. Checks the caller owns the home, inserts
  `plan_builds` (`step 'reading'`, `progress 2`) and **returns
  `{ build_id }` right away with 202**. Then, in `EdgeRuntime.waitUntil`, it
  advances roughly every 700 ms: `8 reading` (appliances counted) → `28
  manuals` (models matched in `appliance_models`) → `50 tasks` (`model_tasks`)
  → `74 parts` (`part_prices`: `summary.parts = [{name, price}]`, lowest
  in-stock price per part) → `94 adjusting` → `100 ready`, with
  `options = priceAllTiers(...)` using live `pricing_settings` and
  `task_defaults`. On any failure it sets `step 'error'` and `error`.
  `summary = { appliances, manuals, tasks, parts: [{name, price}], suppliers }`.
- **lookup-appliance**: `POST { model?, brand?, serial?, image?: base64, media_type? }`.
  1. If a model is given and it's in `appliance_models` (case- and
     space-insensitive), return the cached entry (`source: 'cache'`).
  2. Otherwise, with an image and `ANTHROPIC_API_KEY` set, call the Claude
     Messages API (model `claude-opus-5-5`, image input, structured JSON
     output) to read brand, model and serial and to propose maintenance
     tasks mapped to the task keys `hvac|fridge|ice|dish|wh|dryer|smoke`,
     with `interval_months` and `part_number`. It re-checks the cache by the
     extracted model; on a miss it inserts `appliance_models` + `model_tasks`
     with the service role and returns `source: 'ai'`.
  3. With no key it returns 503
     `{ error: 'Plate reading is not configured.', code: 'no_key' }`. On a
     timeout (20 s) or unreadable plate it returns 422
     `{ error: "We couldn't read that plate. Try again or enter it manually.", code: 'unreadable' }`.

  On success it returns
  `{ source: 'cache'|'ai', appliance: { brand, name, model, serial, category, note, model_id }, tasks: [{ task_key, name, interval_months, part_number }] }`.
- **fanout-quote**: `POST { request_id }`. Checks the caller owns the request,
  returns 202, then in `waitUntil` inserts network bids from Summit Pro
  Services (`round(base × 0.88)`, available today +4) after 1.5 s and from
  Clearview & Sons (`round(base × 1.14)`, today +6) 1.3 s later. It skips a
  bid if the request is no longer open or that vendor already bid. The client
  calls it fire-and-forget after `request_quote`. If it fails, the homeowner
  still gets the real vendor's bid.

## 6. Demo scenario (seeded by `seed_demo`, relative to "today" in Chicago)

**Accounts** (password `phpdemo2026` for all):

| Role | Email | Name | Notes |
|---|---|---|---|
| homeowner | `homeowner@php.test` | Elena Alvarez | onboarded, 12 Linden Court, PHP Recommended |
| homeowner | `newhome@php.test` | Jordan Lee | no home: the onboarding demo |
| tech | `tech@php.test` | Marcus Reyes | title "Senior technician · 4.9 · 212 visits", vehicle "Silver Transit van · PHP-214" |
| vendor | `vendor@php.test` | Sam Ortiz | vendor Evergreen Outdoor Co. (★4.9, all six categories, vetted) |
| office | `office@php.test` | Avery Brooks | office manager |

These users also exist, but aren't for demo logins: `dana@php.test` (tech Dana
Liu, "Technician · 4.8 · 96 visits"), and homeowners `david@php.test` (David
Okafor), `whitfield@php.test` (The Whitfields), `priya@php.test` (Priya Shah)
and `bell@php.test` (Mark & Jo Bell).

Fixed user ids: `a0000000-0000-4000-8000-0000000000NN`, with NN = 01 office,
02 Marcus, 03 Dana, 04 vendor Sam, 05 Elena, 06 Jordan, 07 David, 08
Whitfields, 09 Priya, 10 Bells.

**Elena's home.** 12 Linden Court, Dallas, TX 75205: 3,420 sq ft, built 2006,
4 bd / 3.5 ba, 2 floors, 2 zones, pets, city · hard water. Notes: "Gate code
4471. Heater in garage, back left." Her five appliances are the `APPLIANCES` in
`src/data/seed.ts`, all linked to `appliance_models`. She has an active plan
`recommended` (the monthly and annual prices computed from the defaults).

**Visits**, with the 7-day notice (`7d`/`email`) already sent for each:

| Client | Day, time | Tech | Plan | Tasks | Status |
|---|---|---|---|---|---|
| Elena | today 9:00–11:00 AM | Marcus | recommended | all 7 | scheduled, unconfirmed |
| David Okafor, 4410 Bryn Mawr Dr, Dallas, TX 75225 | today 12:00–2:00 PM | Marcus | medium | medium baseline | confirmed |
| The Whitfields, 88 Beverly Dr, Dallas, TX 75205 | today 3:00–5:00 PM | Marcus | high | all 7 | confirmed |
| Priya Shah, 17 Stonebridge Dr, Dallas, TX 75204 | tomorrow 9:00 AM | Dana | recommended | | awaiting (unconfirmed) |
| Mark & Jo Bell, 203 Lakewood Blvd, Dallas, TX 75214 | today +2, 10:00 AM | Dana | low | | confirmed |

Elena's `offered_slots` are today 9–11 AM, tomorrow 1–3 PM, and today +3 8–10 AM.

**Reference data.**

- `appliance_models` + `model_tasks` for the 5 seeded models, as the cache:
  Carrier → `hvac` (every 2 mo, 16x25x4-MERV11); LG → `fridge` (6 mo,
  LT1000P) and `ice` (6 mo, ICE-SANI); Bosch → `dish` (1 mo, AFFRESH-DW);
  Rheem → `wh` (6 mo, WH-DRAIN); Whirlpool → `dryer` (12 mo).
- `part_prices`: 9 parts across 5 suppliers (Home Depot, Lowe's, Amazon,
  Ferguson, SupplyHouse), with the lowest in-stock prices matching
  `TASKS[].cost`.
- `vendors`: Evergreen (profile 04), and Summit Pro Services (★4.8) and
  Clearview & Sons (★4.7) with no profile. All vetted, all six categories.
- No quote requests, bids, reports or 48-hour notices.

## 7. Test hooks

Playwright selects by accessible role and name, so keep `accessibilityLabel` /
`accessibilityRole` on interactive elements and add `testID` for anything
ambiguous. Required `testID`s:

`login-email`, `login-password`, `login-submit`, `login-error`, `demo-mode-toggle`,
`app-exit` (sign-out link), `tech-banner` (homeowner live banner),
`visit-advance` (tech status button), `task-<key>` (tech checkbox),
`photo-<key>` (tech + Photo), `visit-complete`, `report-card`,
`addon-<category>` (homeowner service tile), `bid-<vendorName>` (homeowner bid
row) with a `Book` pill inside, `vendor-request-<category>`, `vendor-submit`,
`office-reset`, `office-fees` (the coordination-fees `LqStat`),
`pricing-rate` (the labor-rate tile), `tier-monthly-<index>` (homeowner Plan
tab's monthly price for the current tier: `plan-monthly`),
`research-progress`, `onboarding-start`.
