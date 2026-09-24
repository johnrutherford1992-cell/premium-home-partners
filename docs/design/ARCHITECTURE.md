# Architecture — Expo + Supabase

## Monorepo (pnpm + Turborepo)
```
apps/
  mobile/            Expo Router app (homeowner, technician, and vendor roles by auth claim)
    app/(auth)/…
    app/(homeowner)/onboarding/[step].tsx, (tabs)/home|plan|reports|services
    app/(tech)/route.tsx, job/[visitId].tsx
    app/(vendor)/requests.tsx, request/[id].tsx
  office/            Expo web (or Next.js) console: pricing, dispatch, quotes, clients, vendors
packages/
  ui/                RN port of Liquid Glass: LqGlass, LqCard, LqButton, LqBadge, LqStat, LqSectionTitle + theme tokens (light/dark)
  pricing/           Shared pricing and schedule logic (see PRICING.md), with unit tests
  db/                Generated Supabase types + typed queries (React Query hooks)
supabase/
  migrations/        DATA_MODEL.sql
  functions/         lookup-appliance, build-plan, price-parts, send-notices, fanout-quote, publish-report
```

## Key libraries
expo-router, expo-camera, expo-image-picker, expo-blur (glass), expo-notifications, react-native-reanimated, @tanstack/react-query, zustand, @supabase/supabase-js, nativewind (optional).

## AI pipeline (edge functions)
1. **lookup-appliance**: input is the OCR text or plate photo. Parse the brand, model and serial, and decode the manufacture date from the serial where the brand's pattern is known. Look up `appliance_models` (cache). On a cache miss, call an LLM with web search to find the manual and extract structured maintenance tasks (`task, interval_months, part_numbers, source_url, page`). Store the result with citations.
2. **price-parts**: for each part number, query supplier APIs / web search and store `part_prices` (supplier, price, url, fetched_at). Refresh every 30 days. Pricing uses the lowest in-stock price.
3. **build-plan**: combines home profile adjustments, tasks and prices into 4 tier options (the `pricing` package). Writes `plan_builds` progress for the Realtime progress UI.

## Scheduling and notices
- When a plan is created, generate `visits` for 12 months using the visit-spacing rule, then assign techs by zone and capacity (the office can override in Dispatch).
- `send-notices` runs hourly via pg_cron. It sends the 7-day notice (full task list, confirm or reschedule) and the 48-hr notice (prep notes), each as push + email + SMS (Twilio). Sends are logged to `notices`.
- Tech "Start driving" sets `visits.status = 'enroute'`. A trigger then sends the on-the-way push with ETA.

## Field work
The tech checklist comes from `visit_tasks`. Required photos (before/after) are uploaded to Storage, with offline upload queuing. `publish-report` runs when all tasks are complete: it computes home health, creates the `reports` row and notifies the homeowner.

## Brokerage
`fanout-quote` matches vendors by category and service radius, then notifies them. Vendors submit `bids`. When the homeowner books one, the request status becomes `booked`, the other vendors are notified, and a `coordination_fee` is recorded. Payments go through Stripe Connect: homeowner pays, the vendor is paid out, and PHP's fee is kept as the application fee.

## Auth and roles
Supabase Auth (phone OTP for homeowners and vendors, SSO/email for office). The custom claim `role ∈ homeowner | tech | vendor | office` is enforced with row-level security (see DATA_MODEL.sql).

## Build order (suggested)
1. `packages/ui` tokens + 6 components, with light/dark themes.
2. Schema + RLS + seed data from the prototype.
3. Homeowner onboarding: address → scan (manual entry fallback) → details → build-plan → tiers → Stripe subscription.
4. Visits + tech app checklist/photos → report.
5. Office pricing + dispatch.
6. Add-on brokerage + vendor portal.
7. Notices (cron) + push.
