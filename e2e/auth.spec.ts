// Sign-in through the real login form, role routing, and sign-out.
// The only spec that signs in through the UI (see helpers.ts on rate limits).

import { allowConsoleErrors, expect, test } from './fixtures';
import { ACCOUNTS, PASSWORD, login, openAs, requireBackend, resetDemo, closeAll, type Account } from './helpers';

/** Something only that role's landing screen shows. */
const LANDMARK: Record<Account, string> = {
  homeowner: 'Linden Court',
  newhome: 'Set up my home',
  tech: "Today's route",
  vendor: 'Quote requests',
  office: 'Tier pricing',
};

test.describe('auth', () => {
  requireBackend();

  test.beforeAll(async () => {
    await resetDemo();
  });

  for (const account of ['homeowner', 'newhome', 'tech', 'vendor'] as const) {
    test(`${ACCOUNTS[account].email} lands in their app`, async ({ page }) => {
      await login(page, account);
      await expect(page.getByText(LANDMARK[account]).first()).toBeVisible();
      await expect(page.getByTestId('app-exit')).toHaveText('Sign out');
    });
  }

  test('office@php.test lands in the office console', { tag: '@desktop' }, async ({ page }) => {
    await login(page, 'office');
    await expect(page.getByText(LANDMARK.office).first()).toBeVisible();
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

  test('a homeowner opening /office is sent back to /homeowner', async ({ browser }) => {
    const elena = await openAs(browser, 'homeowner');
    try {
      await elena.page.goto('/office/pricing');
      await expect(elena.page).toHaveURL(ACCOUNTS.homeowner.landing);
      await expect(elena.page.getByText(LANDMARK.office)).toHaveCount(0);
    } finally {
      await closeAll(elena);
    }
  });

  test('Sign out (app-exit) returns to /login and guards the app again', async ({ page }) => {
    // A fresh UI session: signing out ends it on the server, so it can't be a shared one.
    await login(page, 'tech');
    await page.getByTestId('app-exit').click();
    await expect(page).toHaveURL(/\/login\/?$/);
    await expect(page.getByTestId('login-email')).toBeVisible();
    await page.goto('/tech');
    await expect(page).toHaveURL(/\/login\/?$/);
    await expect(page.getByTestId('login-email')).toBeVisible();
  });
});
