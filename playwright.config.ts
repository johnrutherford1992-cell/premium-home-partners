// End-to-end tests for the web build of apps/mobile. See e2e/README.md.
//
//   E2E_BASE_URL            app under test; unset → serve apps/mobile/dist on E2E_PORT (8105)
//   E2E_SUPABASE_URL        Supabase project for API helpers (fallback: apps/mobile/.env)
//   E2E_SUPABASE_ANON_KEY   its anon key (public client config)
//   E2E_OFFLINE=1           skip the specs that need the backend
//   E2E_RUN                 names the output folder (the CI loop uses run-1, run-2, …)

import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_URL, DESKTOP, DIST_DIR, EXTERNAL_BASE_URL, PHONE, PORT, ROOT } from './e2e/env';

const RUN = process.env.E2E_RUN || 'local';
const OUT = join(ROOT, 'e2e/output', RUN);
const serveLocal = !EXTERNAL_BASE_URL;

if (serveLocal && !existsSync(join(DIST_DIR, 'index.html'))) {
  console.warn(
    `[e2e] ${DIST_DIR} has no build and E2E_BASE_URL is unset: browser specs will fail. ` +
      'Build it (cd apps/mobile && npx expo export --platform web) or point E2E_BASE_URL at a running app.',
  );
}

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // One shared backend: everything runs in order, one test at a time, no retries.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: join(OUT, 'test-results'),
  reporter: [
    ...(process.env.GITHUB_ACTIONS ? ([['github']] as const) : []),
    ['list'],
    ['html', { outputFolder: join(OUT, 'report'), open: 'never' }],
  ],
  use: {
    baseURL: BASE_URL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'en-US',
    timezoneId: 'America/Chicago',
    browserName: 'chromium',
  },
  projects: [
    // Supabase only (supabase-js), no browser.
    { name: 'api', testMatch: '**/rls.spec.ts' },
    // Office tests are tagged @desktop; everything else runs on a phone.
    { name: 'phone', testIgnore: '**/rls.spec.ts', grepInvert: /@desktop/, use: { ...PHONE } },
    { name: 'desktop', testIgnore: '**/rls.spec.ts', grep: /@desktop/, use: { ...DESKTOP } },
  ],
  webServer: serveLocal
    ? {
        command: `node e2e/serve.mjs "${DIST_DIR}" ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
        stdout: 'ignore',
        stderr: 'pipe',
      }
    : undefined,
});
