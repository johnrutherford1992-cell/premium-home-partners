# End-to-end tests

Playwright tests for the web build of `apps/mobile`, run against a real
Supabase project. The config is `playwright.config.ts` at the repo root.

| Spec | Needs backend | What it covers |
|---|---|---|
| `auth.spec.ts` | yes | All 5 demo accounts sign in through the login form and land in their app. A wrong password shows `login-error`. A homeowner who opens `/office` is sent back. Sign out returns to `/login`. |
| `visit-live.spec.ts` | yes | Tech and homeowner on two devices. Start driving, arrive, check off every task, upload a photo, complete the visit. The homeowner's banner follows along live, and the report shows the health score and the photo. |
| `quotes-live.spec.ts` | yes | Homeowner, vendor and office on three devices. The homeowner requests a quote, the vendor bids, the homeowner books it. The office sees a 10% fee and the vendor sees "Won · scheduled". |
| `pricing-live.spec.ts` | yes | The office raises the labor rate. The homeowner's Plan price rises live, and "Reset demo data" restores it. |
| `onboarding.spec.ts` | yes | `newhome@php.test` goes through address, 5 plate scans, details, the plan build to 100% and Start. Marcus then sees Jordan Lee on his route. |
| `rls.spec.ts` | yes (API only) | Row-level security and RPC guards for each role and for anon. Direct table writes are rejected. |
| `demo-mode.spec.ts` | no | Offline demo from start to finish: toggle, launcher, onboarding, tech visit, report. |
| `responsive.spec.ts` | partly | No sideways overflow at 390 px, and the office sidebar renders at 1280 px. The demo checks always run. The live checks need a backend. |

Every spec that uses the backend first calls `reset_demo()` as the office
account, so the specs don't depend on each other. Tests run one at a time
with no retries. Any `console.error` or uncaught page error fails the test
(`e2e/fixtures.ts`). The only allowed error is Supabase Auth's HTTP 400 in the
wrong-password test, and that test causes it on purpose.

## Configuration

| Variable | Meaning |
|---|---|
| `E2E_BASE_URL` | The app to test. If unset, `e2e/serve.mjs` serves `apps/mobile/dist` on `http://localhost:$E2E_PORT` (default 8105). |
| `E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY` | The Supabase project, used for `resetDemo()`, the RLS checks and test sessions. If unset, they're read from `EXPO_PUBLIC_SUPABASE_*` in `apps/mobile/.env.local` or `apps/mobile/.env`. The anon key is public client config, not a secret. It must be the same project the app was built against. |
| `E2E_OFFLINE=1` | Skip the specs that need the backend. They're also skipped when no project is configured. |
| `E2E_LOGIN=ui` | Multi-device specs sign in through the login form instead of using API sessions (see below). |
| `E2E_RUN` | Name of the output folder: `e2e/output/<run>/report` for the HTML report, and `test-results` for traces and screenshots of failures. |

Projects: `phone` (390×844, touch), `desktop` (1280×900, tests tagged
`@desktop`), and `api` (`rls.spec.ts`, no browser). In multi-device specs, the
office always runs on a desktop and the other roles on a phone.

**Sign-in rate limit.** By default Supabase allows 30 password sign-ins per
5 minutes per IP. Only `auth.spec.ts` uses the login form (7 sign-ins per
run). Every other spec signs each role in once over the API and injects that
session into the browser's storage, the same way the app stores it. Sessions
are cached in `e2e/output/.auth/`, which is git-ignored and never uploaded,
and reused while they have 20 or more minutes left.

## Run locally

```sh
npm ci
npx playwright install chromium        # once

# Build the web app. Put the project's EXPO_PUBLIC_SUPABASE_URL /
# EXPO_PUBLIC_SUPABASE_ANON_KEY in apps/mobile/.env.local for a live build.
cd apps/mobile && npx expo export --platform web --output-dir dist && cd ../..

npx playwright test                    # serves apps/mobile/dist on :8105
npx playwright test visit-live         # one spec
npx playwright test --project=api      # RLS checks only
npx playwright show-report e2e/output/local/report
```

Without a backend, for example in the offline demo or with no network,
only the no-backend specs run:

```sh
E2E_OFFLINE=1 npx playwright test demo-mode responsive
```

If several builds run at once on one machine, give each one its own
`TMPDIR`. Metro's cache in `$TMPDIR/metro-cache` is shared, and it can mix
inlined `EXPO_PUBLIC_*` values between builds.

## Run against a deployed app

```sh
E2E_BASE_URL=https://your-app.example.com \
E2E_SUPABASE_URL=https://<ref>.supabase.co \
E2E_SUPABASE_ANON_KEY=<anon key> \
npx playwright test
```

## Run in GitHub Actions

Go to **Actions → E2E → Run workflow** (`.github/workflows/e2e.yml`, manual
only). It takes these inputs:

- `supabase_url`, `supabase_anon_key`: the project to test against.
- `base_url` (optional): a deployed app. If empty, the workflow builds
  `apps/mobile` for the web against the project above and serves it.
- `runs` (default 3): how many full runs in a row. The job stops at the first
  failing run.

The HTML reports, and the traces and screenshots of failures, are uploaded
as the `e2e-report-…` artifact. Runs against the same project are queued one
at a time, because every spec resets the demo data.
