// Layout guards: at 390px no screen scrolls sideways (the document's
// scrollWidth never exceeds innerWidth), and at 1280px the office console
// renders its 200pt sidebar. Checked in offline demo mode (no backend) and,
// when a backend is configured, in live mode for every role.

import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { PHONE, closeAll, expectNoHorizontalScroll, openAs, presetDemo, requireBackend, resetDemo, type Account } from './helpers';

interface ScreenCheck {
  path: string;
  /** Text that proves the screen rendered. */
  text: string;
}

const FIRST_RUN: ScreenCheck[] = [
  { path: '/', text: 'One home, four apps' },
  { path: '/homeowner', text: 'Set up my home' },
];

const MAIN_SCREENS: ScreenCheck[] = [
  { path: '/homeowner/home', text: 'NEXT VISIT' },
  { path: '/homeowner/plan', text: 'Your year of care' },
  { path: '/homeowner/reports', text: 'Your first report arrives after the visit' },
  { path: '/homeowner/services', text: 'Add-on services' },
  { path: '/tech', text: "Today's route" },
  { path: '/tech/job', text: 'NOTES FROM CLIENT' },
  { path: '/vendor', text: 'Quote requests' },
  { path: '/office/pricing', text: 'Tier pricing' },
  { path: '/office/dispatch', text: 'WEEK OF' },
  { path: '/office/quotes', text: 'BROKERED WORK' },
];

const OFFICE_PAGES: ScreenCheck[] = MAIN_SCREENS.filter((s) => s.path.startsWith('/office'));

async function checkScreens(page: Page, screens: ScreenCheck[]) {
  for (const s of screens) {
    await page.goto(s.path);
    await expect(page.getByText(s.text).first(), `${s.path} rendered`).toBeVisible();
    await expectNoHorizontalScroll(page, `${s.path} @ ${page.viewportSize()?.width}px`);
  }
}

/** The wide office layout: sidebar title, the three tabs and Reset demo data, left of the content. */
async function expectSidebar(page: Page, path: string) {
  const title = page.getByText('PHP Office', { exact: true });
  await expect(title, `${path}: sidebar title`).toBeVisible();
  for (const tab of ['Pricing', 'Dispatch', 'Add-on quotes']) {
    await expect(page.getByRole('tab', { name: tab }), `${path}: ${tab} tab`).toBeVisible();
  }
  await expect(page.getByTestId('office-reset'), `${path}: Reset demo data`).toBeVisible();
  const box = await title.boundingBox();
  expect(box && box.x + box.width, `${path}: the sidebar sits on the left`).toBeLessThan(300);
}

test.describe('responsive · offline demo', () => {
  test('first-run screens fit a 390px phone', async ({ page }) => {
    await presetDemo(page);
    await checkScreens(page, FIRST_RUN);
  });

  test('every role’s main screen fits a 390px phone', async ({ page }) => {
    await presetDemo(page, { step: 6 }); // an onboarded homeowner
    await checkScreens(page, MAIN_SCREENS);
  });

  test('office pages at 1280px render the sidebar', { tag: '@desktop' }, async ({ page }) => {
    await presetDemo(page);
    for (const s of OFFICE_PAGES) {
      await page.goto(s.path);
      await expect(page.getByText(s.text).first()).toBeVisible();
      await expectSidebar(page, s.path);
      await expectNoHorizontalScroll(page, `${s.path} @ 1280px`);
    }
  });
});

test.describe('responsive · live', () => {
  requireBackend();

  test.beforeAll(async () => {
    await resetDemo();
  });

  const LIVE_MAIN: Record<Exclude<Account, 'office'>, ScreenCheck[]> = {
    homeowner: MAIN_SCREENS.filter((s) => s.path.startsWith('/homeowner/') && s.path !== '/homeowner/reports'),
    newhome: [{ path: '/homeowner', text: 'Set up my home' }],
    tech: [{ path: '/tech', text: "Today's route" }],
    vendor: [{ path: '/vendor', text: 'Quote requests' }],
  };

  for (const account of ['homeowner', 'newhome', 'tech', 'vendor'] as const) {
    test(`${account}: main screens fit a 390px phone`, async ({ browser }) => {
      const r = await openAs(browser, account);
      try {
        await checkScreens(r.page, LIVE_MAIN[account]);
      } finally {
        await closeAll(r);
      }
    });
  }

  test('office: pages fit a 390px phone', async ({ browser }) => {
    const r = await openAs(browser, 'office', { device: PHONE });
    try {
      await checkScreens(r.page, OFFICE_PAGES);
    } finally {
      await closeAll(r);
    }
  });

  test('office: pages at 1280px render the sidebar', { tag: '@desktop' }, async ({ browser }) => {
    const r = await openAs(browser, 'office');
    try {
      for (const s of OFFICE_PAGES) {
        await r.page.goto(s.path);
        await expect(r.page.getByText(s.text).first()).toBeVisible();
        await expectSidebar(r.page, s.path);
        await expectNoHorizontalScroll(r.page, `${s.path} @ 1280px`);
      }
    } finally {
      await closeAll(r);
    }
  });
});
