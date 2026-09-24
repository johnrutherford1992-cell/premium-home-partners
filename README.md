# Premium Home Partners

Subscription home maintenance, in four connected apps built from the **Concierge Mist** (Liquid Glass) design:

| App | Route | What it does |
|---|---|---|
| Homeowner | `/homeowner` | 5-step onboarding (address → serial-plate scan → home details → AI research → coverage tier), then Home · Plan · Reports · Services tabs |
| Technician | `/tech` | Today's route, Start driving / Arrived, photo checklist, Complete & send report |
| Vendor portal | `/vendor` | Quote-request inbox, price + date bid form, won/lost status |
| Office console | `/office` | Tier pricing calculator, dispatch with notice status, brokered add-on quotes |

One Expo Router app serves all four roles on iOS, Android and web.

## Layout

```
apps/mobile/          Expo SDK 57 + Expo Router app (all four roles)
  src/app/            routes: homeowner/, tech/, vendor/, office/
  src/ui/             React Native port of the Liquid Glass primitives (LqGlass, LqCard, LqButton, LqBadge, LqStat, LqSectionTitle)
  src/theme/tokens.ts light "Mist" / dark "Aurora" tokens
  src/store/          zustand store (demo mode) + derived pricing/schedule hooks
packages/pricing/     shared tier pricing + visit scheduling (with tests), used by the app and the build-plan edge function
supabase/             schema + RLS migration, seed, build-plan edge function
docs/design/          the original design handoff (spec, pricing algorithm, data model, architecture)
```

## Run it

```bash
npm install
npm run web            # browser
npm run dev            # Expo dev server (iOS / Android via Expo Go or a dev build)
npm test               # pricing unit tests
npm run typecheck
npm run build:web      # static web build → apps/mobile/dist
```

## Demo mode vs. Supabase

With no Supabase env vars set, the app runs in **demo mode**: every role shares one on-device store (persisted with AsyncStorage/localStorage), exactly like the connected prototype. Onboard a home, start the visit in the Technician app, bid from the Vendor portal, change labor rates in the Office and watch prices update everywhere. **Reset demo** on the launcher clears it.

Prices, suppliers, serial-plate OCR and AI research are sample data in demo mode.

To connect a backend:

1. Create a Supabase project and run `supabase db push` (applies `supabase/migrations`) and `supabase db seed`.
2. Deploy the edge function: `supabase functions deploy build-plan`.
3. Copy `apps/mobile/.env.example` to `apps/mobile/.env` and set `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

`src/lib/supabase.ts` creates the client when those are set. The screens still read from the demo store; switching each slice to React Query + Realtime over the tables is the next step (see Roadmap).

## Deploy

- **Web:** `vercel.json` at the repo root builds `apps/mobile` and serves it as a single-page app. Import the repo in Vercel (no framework preset needed).
- **iOS / Android:** `npx eas-cli@latest build` from `apps/mobile` (bundle id `com.premiumhomepartners.app`).

## Roadmap

Following the build order in `docs/design/ARCHITECTURE.md`:

- [x] Liquid Glass UI kit with light/dark themes
- [x] All four apps' screens and cross-app flows (demo mode)
- [x] Shared pricing package + tests
- [x] Schema, RLS, seed, `build-plan` edge function
- [ ] Supabase Auth (phone OTP for homeowners/vendors, email for office) and role routing
- [ ] Replace demo store slices with React Query + Realtime (`visits`, `visit_tasks`, `quote_requests`, `bids`, `plan_builds`)
- [ ] Camera + on-device OCR for serial plates (`expo-camera`), `lookup-appliance` and `price-parts` edge functions (LLM + web search)
- [ ] Photo upload to the `visit-photos` bucket, `publish-report`
- [ ] `send-notices` (pg_cron) with push/email/SMS, `fanout-quote`
- [ ] Stripe subscriptions and Stripe Connect payouts
