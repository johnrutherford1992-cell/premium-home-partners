// Offline demo mode needs no backend: the login screen's toggle (or a build
// with no Supabase config, which is always in demo) opens the launcher, and
// the four apps share this device's store end to end.
//
// Screens you leave stay mounted (hidden) in the web stack, and the launcher
// is opened several times, so every lookup goes through shown().

import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { shown } from './helpers';

const byText = (page: Page, text: string | RegExp, exact = false) => shown(page.getByText(text, { exact }));
const button = (page: Page, name: string | RegExp) => shown(page.getByRole('button', { name, exact: typeof name === 'string' }));
const testId = (page: Page, id: string) => shown(page.getByTestId(id));

test.describe('offline demo mode', () => {
  test('toggle → launcher → onboarding → tech visit → report', async ({ page }) => {
    // --- Login screen toggle → launcher --------------------------------------
    await page.goto('/login');
    const toggle = testId(page, 'demo-mode-toggle');
    const launcher = byText(page, 'One home, four apps');
    await expect(toggle.or(launcher).first()).toBeVisible({ timeout: 30_000 });
    if (await toggle.isVisible()) {
      await toggle.click(); // live build: the offline toggle
      await expect(button(page, 'Exit offline demo')).toBeVisible();
    } // else: a build without Supabase config is forced into demo and /login redirects to the launcher
    await expect(launcher).toBeVisible();
    await expect(byText(page, 'OFFLINE DEMO', true)).toBeVisible();

    // --- Homeowner onboarding ------------------------------------------------
    await testId(page, 'launch-homeowner').click();
    await button(page, 'Set up my home').click();
    await expect(shown(page.getByLabel('YOUR NAME', { exact: true }))).toHaveValue('Elena Alvarez');
    await expect(shown(page.getByLabel('SERVICE ADDRESS', { exact: true }))).toHaveValue('12 Linden Court, Mountain Brook, AL 35213');
    await button(page, 'Continue').click();

    const shutter = shown(page.getByLabel('Capture serial plate', { exact: true }));
    for (let n = 1; n <= 5; n++) {
      await shutter.click();
      await expect(byText(page, n < 5 ? `Tap shutter · ${n} of 5 captured` : 'All 5 appliances found')).toBeVisible();
    }
    await button(page, 'Continue').click();
    await button(page, 'Build my plan').click();
    const options = button(page, 'See my plan options');
    await expect(options).toBeEnabled({ timeout: 20_000 });
    await expect(byText(page, '100%', true)).toBeVisible();
    await options.click();
    await button(page, /^Start /).click();
    await expect(page).toHaveURL(/\/homeowner\/home\/?$/);
    await expect(byText(page, 'NEXT VISIT', true)).toBeVisible();

    // --- Technician visit ----------------------------------------------------------
    await testId(page, 'app-exit').click();
    await expect(launcher).toBeVisible();
    await testId(page, 'launch-tech').click();
    await shown(page.getByRole('button').filter({ hasText: 'tap to open' })).click();
    await button(page, 'Start driving · notify client').click();
    await button(page, 'Mark arrived on site').click();
    const boxes = shown(page.getByRole('checkbox'));
    await expect(boxes.first()).toBeEnabled();
    const count = await boxes.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await boxes.nth(i).click();
      await expect(boxes.nth(i)).toBeChecked();
    }
    await expect(byText(page, `${count} / ${count}`, true)).toBeVisible();
    await button(page, 'Complete & send report').click();
    await expect(button(page, 'Report sent ✓')).toBeVisible();

    // --- The report reaches the homeowner app -----------------------------------------
    await byText(page, '‹ Route', true).click();
    await testId(page, 'app-exit').click();
    await expect(testId(page, 'launch-tech')).toContainText('Visit complete');
    await testId(page, 'launch-homeowner').click();
    await expect(byText(page, 'Visit complete · report ready')).toBeVisible();
    await shown(page.getByRole('tab', { name: 'Reports' })).click();
    await testId(page, 'report-card').first().click();
    await expect(byText(page, 'Visit report')).toBeVisible();
    await expect(byText(page, 'Home health')).toBeVisible();
  });
});
