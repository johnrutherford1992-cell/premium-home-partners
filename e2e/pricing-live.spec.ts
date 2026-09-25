// The office raises the labor rate on a desktop; Elena's Plan tab on her phone
// reprices live. "Reset demo data" puts everything back.

import { expect, test } from './fixtures';
import { closeAll, dollars, expectNoReload, markNoReload, openAs, requireBackend, resetDemo, type RolePage } from './helpers';

const LIVE = { timeout: 15_000 };

test.describe.serial('pricing: office rate changes reach the homeowner live', () => {
  requireBackend();

  let home: RolePage;
  let office: RolePage;
  let monthlyBefore = 0;
  let rateBefore = 0;

  const monthly = () => home.page.getByTestId('plan-monthly');
  const rate = () => office.page.getByTestId('pricing-rate');

  test.beforeAll(async ({ browser }) => {
    await resetDemo();
    home = await openAs(browser, 'homeowner', { path: '/homeowner/plan', ready: (p) => p.getByTestId('plan-monthly') });
    office = await openAs(browser, 'office', { path: '/office/pricing', ready: (p) => p.getByTestId('pricing-rate') });
    await markNoReload(home.page);
  });

  test.afterAll(async () => {
    await closeAll(home, office);
  });

  test('three taps on the labor-rate "+" raise Elena’s monthly price', async () => {
    await expect(monthly()).toContainText('$');
    monthlyBefore = dollars(await monthly().innerText());
    rateBefore = dollars(await rate().innerText());
    expect(monthlyBefore).toBeGreaterThan(0);

    const plus = rate().getByLabel('Increase', { exact: true });
    for (let i = 1; i <= 3; i++) {
      await plus.click();
      // Labor rate steps by $2 (SETTING_LIMITS.rate.step).
      await expect.poll(async () => dollars(await rate().innerText())).toBe(rateBefore + 2 * i);
    }

    await expect
      .poll(async () => dollars(await monthly().innerText()), { ...LIVE, message: 'plan-monthly after the rate change' })
      .toBeGreaterThan(monthlyBefore);
    await expectNoReload(home.page);
  });

  test('Reset demo data restores the rate and Elena’s price', async () => {
    const reset = office.page.getByTestId('office-reset');
    await reset.click();
    await expect(office.page.getByText('Demo data restored')).toBeVisible();
    await expect.poll(async () => dollars(await rate().innerText())).toBe(rateBefore);
    await expect
      .poll(async () => dollars(await monthly().innerText()), { ...LIVE, message: 'plan-monthly after the reset' })
      .toBe(monthlyBefore);
    await expectNoReload(home.page);
  });
});
