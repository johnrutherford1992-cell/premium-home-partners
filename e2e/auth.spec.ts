// Demo access: every side of the live app opens from the launcher with no
// password, "‹ All apps" comes back, switching sides in one tab shows each
// side's own data, and deep links open the right side in a fresh tab. The
// /login form still works for a specific account.
//
// Every switch to an account this tab hasn't used yet is a real password
// sign-in (Supabase allows 30 per 5 minutes per IP; see helpers.ts). This
// spec makes 10 of them per run, and the return trip in "switching" proves
// the app reuses its cached session instead of signing in again.

import type { Page } from '@playwright/test';
import { allowConsoleErrors, expect, test } from './fixtures';
import {
  ACCOUNTS,
  PASSWORD,
  TAB_ID_KEY,
  demoSessionsKey,
  expectAccount,
  expectLanding,
  expectNoHorizontalScroll,
  login,
  requireBackend,
  resetDemo,
  shown,
  type Account,
} from './helpers';

/** Something only that role's landing screen shows. */
const LANDMARK: Record<Account, string> = {
  homeowner: 'Linden Court',
  newhome: 'Set up my home',
  tech: "Today's route",
  vendor: 'Quote requests',
  office: 'Tier pricing',
};

/** The launcher at /, live (not the offline one, and not a login form). */
async function openLauncher(page: Page): Promise<void> {
  await expect(shown(page.getByTestId('launch-homeowner'))).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/$/);
  await expect(shown(page.getByText('OFFLINE DEMO', { exact: true }))).toHaveCount(0);
  await expect(page.getByTestId('login-email')).toHaveCount(0);
}

/** Tap a side on the launcher and wait until it's open as that account. */
async function launch(page: Page, account: Exclude<Account, 'newhome'>): Promise<void> {
  await shown(page.getByTestId(`launch-${account}`)).click();
  await expectLanding(page, account);
  await expectAccount(page, account);
  await expect(shown(page.getByText(LANDMARK[account])).first()).toBeVisible();
}

/** "‹ All apps" (testID app-exit) → the launcher, without signing out. */
async function exitToLauncher(page: Page): Promise<void> {
  const exit = shown(page.getByTestId('app-exit'));
  await expect(exit).toContainText('All apps');
  await exit.click();
  await openLauncher(page);
}

/** Password sign-ins (POST /auth/v1/token?grant_type=password) this page makes from now on. */
function countPasswordSignIns(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/auth\/v1\/token\?(?:.*&)?grant_type=password/.test(r.url())) seen.push(r.url());
  });
  return seen;
}

/** The accounts this tab has cached sessions for (apps/mobile/src/lib/demoAccess.tsx). */
async function cachedAccounts(page: Page): Promise<string[]> {
  return page.evaluate(
    ({ tabIdKey, prefix }) => {
      const id = sessionStorage.getItem(tabIdKey);
      const raw = id ? sessionStorage.getItem(prefix + id) : null;
      return raw ? Object.keys(JSON.parse(raw) as Record<string, unknown>).sort() : [];
    },
    { tabIdKey: TAB_ID_KEY, prefix: demoSessionsKey('') },
  );
}

test.describe('demo access', () => {
  requireBackend();

  test.beforeAll(async () => {
    await resetDemo();
  });

  test('the launcher opens every side with no password, and ‹ All apps comes back to it', async ({ page }) => {
    await page.goto('/');
    await openLauncher(page);
    await expectNoHorizontalScroll(page, 'live launcher @ 390px');
    for (const account of ['homeowner', 'tech', 'vendor', 'office'] as const) {
      await launch(page, account);
      await exitToLauncher(page);
    }
  });

  test("switching Elena → Office → Elena in one tab shows each side's own data", async ({ page }) => {
    await page.goto('/');
    await openLauncher(page);

    await launch(page, 'homeowner');
    await expect(shown(page.getByText(LANDMARK.office))).toHaveCount(0);
    await exitToLauncher(page);

    await launch(page, 'office');
    await expect(shown(page.getByText('Good morning, Elena'))).toHaveCount(0);
    await exitToLauncher(page);
    expect(await cachedAccounts(page)).toEqual(['homeowner', 'office']);

    // Back to Elena: the tab restores her cached session, no second sign-in.
    const signIns = countPasswordSignIns(page);
    await launch(page, 'homeowner');
    await expect(shown(page.getByText('Good morning, Elena'))).toBeVisible();
    await expect(shown(page.getByText(LANDMARK.office))).toHaveCount(0);
    expect(signIns, 'switching back to Elena should reuse her cached session').toEqual([]);
  });

  test('a deep link opens that side in a fresh tab, and another role’s link switches to it', { tag: '@desktop' }, async ({ page }) => {
    await page.goto('/office/pricing');
    await expectLanding(page, 'office');
    await expectAccount(page, 'office');
    await expect(shown(page.getByText(LANDMARK.office)).first()).toBeVisible();
    await expect(page.getByTestId('login-email')).toHaveCount(0);

    await page.goto('/vendor');
    await expectLanding(page, 'vendor');
    await expectAccount(page, 'vendor');
    await expect(shown(page.getByText(LANDMARK.vendor)).first()).toBeVisible();
  });

  test('the /login form still signs in as a specific account (Jordan keeps his own homeowner app)', async ({ page }) => {
    await login(page, 'newhome'); // lands on /homeowner/onboarding as Jordan, checked by user id
    await expect(shown(page.getByText(LANDMARK.newhome))).toBeVisible();
    // A homeowner deep link counts Jordan as the right role: no switch to Elena.
    await page.goto('/homeowner');
    await expectLanding(page, 'newhome');
    await expectAccount(page, 'newhome');
  });

  test('a wrong password shows the login error and stays on /login', async ({ page }) => {
    allowConsoleErrors(
      /status of 400.*\/auth\/v1\/token/,
      'Supabase Auth answers a wrong password with HTTP 400, and Chromium logs every non-2xx fetch as a console error. This test sends a wrong password on purpose; the app handles it (login-error).',
    );
    await page.goto('/login');
    await page.getByTestId('login-email').fill(ACCOUNTS.homeowner.email);
    await page.getByTestId('login-password').fill(`${PASSWORD}-wrong`);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('login-error')).toHaveText("That email and password don't match.");
    await expect(page).toHaveURL(/\/login\/?$/);
    // The form is usable again (the button left its "Signing in…" state).
    await expect(page.getByTestId('login-submit')).toHaveText('Sign in');
  });
});
