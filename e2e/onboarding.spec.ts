// Jordan Lee (newhome@php.test, no home yet) onboards end to end against the
// real backend: save_home, set_home_appliances, build-plan research, start_plan.
// Then Marcus sees Jordan's first visit on his route.

import { expect, test } from './fixtures';
import { closeAll, expectRpc, openAs, requireBackend, resetDemo, type RolePage } from './helpers';

const ADDRESS = '45 Maple Ave, Homewood, AL 35209';

test.describe.serial('onboarding: a new homeowner builds and starts a plan', () => {
  requireBackend();

  let jordan: RolePage;
  let tech: RolePage | undefined;

  test.beforeAll(async ({ browser }) => {
    await resetDemo();
    jordan = await openAs(browser, 'newhome');
  });

  test.afterAll(async () => {
    await closeAll(jordan, tech);
  });

  test('address, then five serial plates with the shutter', async () => {
    const p = jordan.page;
    await p.getByRole('button', { name: 'Set up my home' }).click();

    await expect(p.getByLabel('YOUR NAME', { exact: true })).toHaveValue('Jordan Lee');
    await p.getByLabel('SERVICE ADDRESS', { exact: true }).fill(ADDRESS);
    await p.getByRole('button', { name: 'Continue', exact: true }).click();

    const shutter = p.getByLabel('Capture serial plate', { exact: true });
    for (let n = 1; n <= 5; n++) {
      await shutter.click();
      await expect(p.getByText(n < 5 ? `Tap shutter · ${n} of 5 captured` : 'All 5 appliances found')).toBeVisible();
    }
    await expect(p.getByText('Matched', { exact: true })).toHaveCount(5);
    await p.getByRole('button', { name: 'Continue', exact: true }).click();
  });

  test('Build my plan: research reaches 100%', async () => {
    const p = jordan.page;
    const build = p.getByRole('button', { name: 'Build my plan' });
    await expect(build).toBeVisible();
    const buildPlan = p.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/functions/v1/build-plan'),
      { timeout: 30_000 },
    );
    const saved = await expectRpc(p, 'save_home', async () => {
      await expectRpc(p, 'set_home_appliances', () => build.click());
    });
    expect(saved.body).toMatchObject({ p_address: ADDRESS, p_full_name: 'Jordan Lee' });
    const invoked = await buildPlan;
    expect(invoked.ok(), `build-plan answered HTTP ${invoked.status()}`).toBe(true);

    await expect(p.getByTestId('research-progress')).toContainText('100%', { timeout: 30_000 });
    const next = p.getByRole('button', { name: 'See my plan options' });
    await expect(next).toBeEnabled();
    await next.click();
  });

  test('Start the plan → Home shows the next visit', async () => {
    const p = jordan.page;
    const start = p.getByTestId('onboarding-start').getByRole('button'); // wrapper View around the LqButton
    await expect(start).toHaveText('Start PHP Recommended');
    await expect(start).toBeEnabled();
    const { body } = await expectRpc(p, 'start_plan', () => start.click());
    expect(Array.isArray(body.p_schedule) && body.p_schedule.length).toBeGreaterThan(0);
    await expect(p).toHaveURL(/\/homeowner\/home\/?$/, { timeout: 30_000 });
    await expect(p.getByText('NEXT VISIT', { exact: true })).toBeVisible();
    await expect(p.getByText('Marcus Reyes')).toBeVisible();
  });

  test('Marcus sees Jordan Lee on his route', async ({ browser }) => {
    tech = await openAs(browser, 'tech');
    await expect(tech.page.getByText('Jordan Lee').first()).toBeVisible();
  });
});
