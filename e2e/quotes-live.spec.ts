// Three devices: Elena asks for window washing, Evergreen (vendor) bids, Elena
// books it, the office sees the 10% coordination fee, the vendor sees the win.

import { expect, test } from './fixtures';
import { closeAll, dollars, expectNoReload, expectRpc, markNoReload, openAs, requireBackend, resetDemo, shown, type RolePage } from './helpers';

const LIVE = { timeout: 15_000 };
const EVERGREEN = 'Evergreen Outdoor Co.';

test.describe.serial('quotes: request → bid → book → fee, across three devices', () => {
  requireBackend();

  let home: RolePage;
  let vendor: RolePage;
  let office: RolePage;
  let bookedPrice = 0;

  test.beforeAll(async ({ browser }) => {
    await resetDemo();
    home = await openAs(browser, 'homeowner', { path: '/homeowner/services', ready: (p) => p.getByTestId('addon-win') });
    vendor = await openAs(browser, 'vendor');
    office = await openAs(browser, 'office', { path: '/office/quotes', ready: (p) => p.getByTestId('office-fees') });
    for (const r of [home, vendor, office]) await markNoReload(r.page);
  });

  test.afterAll(async () => {
    await closeAll(home, vendor, office);
  });

  test('Elena taps Window washing → the vendor sees the request live', async () => {
    await expect(vendor.page.getByTestId('vendor-request-win')).toHaveCount(0);
    const tile = home.page.getByTestId('addon-win');
    await expect(tile).toContainText('Get quotes');
    await expectRpc(home.page, 'request_quote', () => tile.click(), { p_category: 'win' });
    await expect(tile).not.toContainText('Get quotes');

    const card = vendor.page.getByTestId('vendor-request-win');
    await expect(card).toBeVisible(LIVE);
    await expect(card).toContainText('Window washing');
    await expect(card).toContainText('New request');
    await expectNoReload(vendor.page);
  });

  test('the vendor opens it and submits a quote', async () => {
    const p = vendor.page;
    await p.getByTestId('vendor-request-win').click();
    await expect(p).toHaveURL(/\/vendor\/[0-9a-f-]{36}/);
    const submit = p.getByTestId('vendor-submit').getByRole('button'); // wrapper View around the LqButton
    await expect(submit).toHaveText('Submit quote');
    const { body } = await expectRpc(p, 'submit_bid', () => submit.click());
    expect(body.p_request).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number(body.p_price)).toBeGreaterThan(0);
    expect(String(body.p_available_on)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The request list stays mounted (hidden) under the detail screen: look at the visible one.
    await expect(shown(p.getByText('Quote sent'))).toBeVisible();
  });

  test(`Elena sees ${EVERGREEN}'s bid live and books it`, async () => {
    const row = home.page.getByTestId(`bid-${EVERGREEN}`);
    await expect(row).toBeVisible(LIVE);
    await expectNoReload(home.page);
    bookedPrice = dollars(await row.innerText());
    expect(bookedPrice).toBeGreaterThan(0);

    await expectRpc(home.page, 'book_bid', () => row.getByText('Book', { exact: true }).click());
    await expect(row).toContainText('Booked ✓');
    await expect(home.page.getByTestId('addon-win')).toContainText('Booked ✓');
  });

  test('the office sees a 10% coordination fee live', async () => {
    const fees = office.page.getByTestId('office-fees');
    // book_bid stores round(price × 0.10, 2); the stat shows whole dollars.
    const expected = Math.round(bookedPrice * 0.1);
    expect(expected).toBeGreaterThan(0);
    await expect
      .poll(async () => dollars(await fees.innerText()), { ...LIVE, message: 'office-fees = 10% of the booked price' })
      .toBe(expected);
    await expectNoReload(office.page);
  });

  test('the vendor’s card shows "Won · scheduled"', async () => {
    const p = vendor.page;
    await p.getByText('‹ Requests').click();
    await expect(p).toHaveURL(/\/vendor\/?$/);
    await expect(p.getByTestId('vendor-request-win')).toContainText('Won · scheduled', LIVE);
  });
});
