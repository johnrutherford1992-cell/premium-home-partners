# Handoff: Premium Home Partners — Concierge Mist app suite

## Overview
Premium Home Partners (PHP) runs subscription home maintenance. This bundle covers four connected apps:

1. **Homeowner app** (iOS/Android): home onboarding (serial-plate scan → home profile → AI research → coverage tier), visit notices, photo reports, one-tap add-on quotes.
2. **Technician app** (iOS/Android): daily route, "start driving" / "arrived" status, per-task checklist with required photos, and complete & send report.
3. **Office console** (web, tablet+): pricing calculator (labor rate, trip fee, parts markup, per-task labor minutes, per-tier frequencies, margin), dispatch with notice status, and brokered add-on quote pipeline.
4. **Vendor quote portal** (mobile web or the same Expo app with a vendor role): inbox of quote requests, a bid form (price and date), and won/lost status.

Target stack: **React Native + Expo (Expo Router)**, **Supabase** (Postgres, Auth, Storage, Edge Functions, Realtime). Office console: Expo web build or Next.js sharing the same Supabase client and types.

## About the Design Files
The files in this bundle are **design references created in HTML**. They are prototypes that show intended look and behavior, not production code. Recreate them in React Native / Expo using its patterns (StyleSheet or NativeWind, Expo Router, react-native-reanimated, expo-camera, expo-blur). Open `Premium Home Prototype.dc.html` in a browser to click through the full connected flow. All four apps share one state, so you can see how data moves between roles.

## Fidelity
**High-fidelity.** Colors, type, radii, spacing and copy are final. Recreate them closely using the tokens below. Photos and map tiles are placeholders.

## Screens / Views

### Homeowner — Onboarding (5 steps, 4px segmented progress bar at top, "‹ Back" + "n / 5")
0. **Welcome**: eyebrow "PREMIUM HOME PARTNERS" (mono 12/600, +0.14em, accent). Headline "YOUR HOME, LOOKED AFTER." in Barlow Condensed 64/600, uppercase, line-height 0.9. Body 16px muted. Primary button "Set up my home" (full width, 50h, radius 18).
1. **Address**: name and address text fields (padding 14, radius 14, glass-strong bg, hairline border), map preview (170h, radius 18), and the service-area confirmation "Your technician is Marcus Reyes."
2. **Scan serial plates**: camera viewfinder (220h, radius 22) with an accent bounding box (2.5px, radius 14; opacity 0.35 idle, 1 while reading). A 64px shutter sits below. On capture, run OCR and add the appliance to a list with a "Matched" forest badge. Continue is disabled until one appliance is captured.
3. **About the home**: 2-col grid of steppers (sq ft ±100, year built, bedrooms, bathrooms ±0.5, floors, HVAC zones), pets toggle (44×26, forest when on), and water segmented control (City · hard / Well / Softened). A live insight line explains how these inputs change the schedule.
4. **Researching**: LqStat with percentage, a progress bar, and a 5-line checklist that ticks off as the research advances (read plates → manuals → tasks → parts priced → adjustments). A "Parts priced" card lists the parts that were found.
5. **Choose coverage**: 4 selectable tier rows (radio ring, name, visits/yr · tag, $/mo in display 26). Selected row has a 2px accent border. Summary card shows Materials / Labor / Per year. CTA "Start {tier}".

### Homeowner — Main (floating glass tab bar: Home · Plan · Reports · Services; 62h, radius 31, 16px inset, 24px from bottom)
- **Home**: greeting and street name. Live tech banner (accent fill, pulsing dot) when the tech is en route, on site, or done. Next-visit LqCard shows date (display 34), window, duration, tech row (40px avatar), and task list. A 3-step notice timeline (7 days / 48 hrs / day-of). Confirm and Reschedule buttons (reschedule cycles through offered slots).
- **Plan**: tier and monthly price, a "Change coverage ›" inline tier picker, and "Your year of care": one card per visit with month (display 22) and the tasks included.
- **Reports**: an empty state before the first visit. After the visit, a report card opens the detail view: Home health LqStat (86, ▲4), a 2-col photo grid (BEFORE/AFTER/DRAIN tags), and findings with ochre/forest badges.
- **Services**: 2-col add-on tiles (Lawn care, Landscaping, Window washing, Pressure washing, Holiday lights, Tree service). Tapping one creates a quote request, and the tile label moves through Get quotes → Finding pros… → n quotes → Booked ✓. Request cards list bids (vendor, ★ rating, date, price, Book). Booking one closes the request.

### Technician
- **Route**: 3 LqStats (stops, tasks, miles) and job cards. The active job shows a status badge.
- **Job**: client notes (pets, gate code), a primary status button (Start driving · notify client → Mark arrived on site), and a checklist. The checklist is locked until the tech is on site. Each row has a 26px check square (forest when done) and a "+ Photo" button. "Complete & send report" is enabled only when every task is done. It publishes the report to the homeowner.

### Vendor portal
- **Requests**: Open and Won stats, request cards with status (New request / Quote sent / Won · scheduled / Not selected).
- **Request detail**: scope and exterior photo, price stepper (±$5, or ±$50 above $500), 3 date chips, and "PHP coordination fee 10% · you receive $X". Submit quote. After submitting, a status card shows the vendor's price.

### Office console (sidebar 200px + content)
- **Pricing**: 4 input steppers (Labor $/hr, Trip fee/visit, Parts markup %, Tech cost $/hr). Task table: task, AI part, cost, labor min ±5, and per-tier frequency ± cells (the selected tier's column is tinted accent 16%). Four result cards: $/mo, materials, labor (hours), annual, and gross margin (forest ≥35%, ochre ≥20%, brick below that).
- **Dispatch**: weekly table with window, client, tech, plan, 7-day notice, 48-hr notice, and status. A "Send 48-hr reminders" button.
- **Add-on quotes**: stats (open, booked, coordination fees) and a request table (bids, lowest, status).

## Interactions & Behavior
- Scan: 1.1s "Reading plate…" state, then append. In production, show the camera preview, run on-device OCR (VisionKit / ML Kit via expo module), then call the `lookup-appliance` edge function.
- Research: progress runs 0→100 over about 3s in the prototype. In production, stream progress from `build-plan` using Supabase Realtime on `plan_builds.status`.
- Quote requests: create a `quote_request` and fan it out to matching vendors. Bids stream in over Realtime. The first booking wins and closes the request.
- Tech status changes push notifications to the homeowner: en route → "Marcus is on the way · 12 min", and complete → report ready.
- Notices: a scheduled job (pg_cron + an edge function) sends the 7-day notice (full task list) and the 48-hr notice (prep notes). Day-of notices fire on "Start driving".
- Transitions: 200–300ms ease for toggles and progress. Buttons use active scale 0.98 (built into LqButton).
- Dark mode: a global toggle. Tokens flip, and components need no changes.

## State Management
See `DATA_MODEL.sql` for tables. Client state per app is a React Query cache over Supabase, plus Realtime subscriptions on `visits`, `visit_tasks`, `quote_requests`, and `bids`. Onboarding draft is kept locally (zustand + AsyncStorage) until "Start plan". Pricing logic lives in `PRICING.md` and must be one shared TS module used by the office UI, the homeowner tier screen, and the `build-plan` edge function.

## Design Tokens (Liquid Glass)
Light "Mist":
- `--field` #f4f7fb
- `--paper` #ffffff
- `--ink` #1b2430
- `--muted` #6b7888
- `--glass` rgba(255,255,255,.46)
- `--glass-strong` rgba(255,255,255,.60)
- `--rule` rgba(27,36,48,.09)
- `--accent` #5b86b3
- `--accent-ink` #ffffff
- `--sh` rgba(40,56,80,.28)
- blur 30px

Dark "Aurora":
- `--field` #06080e
- `--paper` #0c1322
- `--ink` #eaf1ff
- `--muted` #8c9bbd
- `--glass` rgba(20,28,50,.42)
- `--glass-strong` rgba(18,26,48,.60)
- `--rule` rgba(120,160,255,.20)
- `--accent` #4ea8ff
- `--accent-ink` #03101f
- blur 26px

Status colors (not themed): forest #5d9069 · ochre #d99a3f · brick #d05757 · slate #7a93b0.

Stage background: a radial bloom of accent at 14% (light) or 30% (dark), placed at 82% / -6%, over the field color.

Type:
- Display: Barlow Condensed 600, uppercase. Sizes 64 / 40 / 34 / 30 / 26 / 22.
- Sans: Avenir / SF Pro. Sizes 16 / 15 / 14 / 13 / 12 / 11.
- Mono: JetBrains Mono. Sizes 12 / 11 / 10, used for eyebrows (+0.06–0.14em tracking, uppercase).

Radius: glass 18 · field inputs 14 · pills 12–20 · device content 47 · tab bar 31.

Spacing: screen padding 22px, stack gap 14px, card padding 16px (LqCard p-4).

Components to port:
- **LqGlass**: blur, hairline border, shadow-sm.
- **LqCard**: LqGlass with 16px padding.
- **LqButton**: primary uses accent fill; ghost uses hairline outline.
- **LqBadge**: pill, 12px text. Tones are status color text + border + 12% fill.
- **LqStat**: uppercase 12px label, 30px value, muted sub line.
- **LqSectionTitle**: display 18, uppercase.

## Assets
None final. Tech photos, map, exterior photo and avatar are placeholders. Use `expo-camera` captures stored in the Supabase Storage bucket `visit-photos/{visit_id}/{task_id}/{before|after}.jpg`.

## Files
- `Premium Home Prototype.dc.html`: the connected, clickable prototype (all four apps).
- `Premium Home App.dc.html`: the 4 explored directions. The chosen one is **1a Concierge Mist**.
- `ARCHITECTURE.md`: Expo/Supabase project structure, edge functions, AI pipeline, notifications.
- `DATA_MODEL.sql`: Supabase schema + RLS outline.
- `PRICING.md`: the tier pricing algorithm, with the defaults used in the prototype.
- `_ds/`: Liquid Glass stylesheet + bundle (the reference implementation of tokens and components).
