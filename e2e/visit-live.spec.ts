// Two devices: the technician works Elena's visit and her Home tab follows
// along live (Realtime, or the 3 s polling floor), without a reload.

import { expect, test } from './fixtures';
import { FILTER_JPG, SEED, closeAll, expectNoReload, expectRpc, markNoReload, openAs, requireBackend, resetDemo, type RolePage } from './helpers';

const LIVE = { timeout: 15_000 };

test.describe.serial('visit: the tech updates Elena’s home screen live', () => {
  requireBackend();

  let home: RolePage;
  let tech: RolePage;

  test.beforeAll(async ({ browser }) => {
    await resetDemo();
    home = await openAs(browser, 'homeowner');
    tech = await openAs(browser, 'tech');
  });

  test.afterAll(async () => {
    await closeAll(home, tech);
  });

  test('Elena sees her scheduled visit and no tech banner', async () => {
    const p = home.page;
    await expect(p.getByText('Marcus Reyes')).toBeVisible();
    await expect(p.getByText('Replace HVAC filters ×2')).toBeVisible();
    await expect(p.getByTestId('tech-banner')).toHaveCount(0);
    await markNoReload(p);
  });

  test('Start driving → Elena sees "is on the way"', async () => {
    const p = tech.page;
    await p.getByRole('button').filter({ hasText: 'Linden Court' }).first().click();
    await expect(p).toHaveURL(/\/tech\/job/);
    // visit-advance / visit-complete are wrapper Views around the LqButton.
    const advance = p.getByTestId('visit-advance').getByRole('button');
    await expect(advance).toContainText('Start driving');
    await expectRpc(p, 'advance_visit', () => advance.click(), { p_visit: SEED.visits.elena });
    await expect(advance).toContainText('Mark arrived on site');

    await expect(home.page.getByTestId('tech-banner')).toContainText('is on the way', LIVE);
    await expect(home.page.getByTestId('tech-banner')).toContainText('Marcus');
    await expectNoReload(home.page);
  });

  test('Mark arrived → Elena sees "is on site"', async () => {
    const advance = tech.page.getByTestId('visit-advance').getByRole('button');
    await expectRpc(tech.page, 'advance_visit', () => advance.click(), { p_visit: SEED.visits.elena });
    await expect(advance).toContainText('On site');
    await expect(home.page.getByTestId('tech-banner')).toContainText('is on site', LIVE);
    await expectNoReload(home.page);
  });

  test('the tech checks off every task and photographs the filter', async () => {
    const p = tech.page;
    for (const key of SEED.taskKeys) {
      const box = p.getByTestId(`task-${key}`);
      await expect(box).toBeEnabled();
      await expect(box).not.toBeChecked();
      await expectRpc(p, 'set_task_done', () => box.click(), { p_done: true });
      await expect(box).toBeChecked();
    }
    await expect(home.page.getByTestId('tech-banner')).toContainText(
      `${SEED.taskKeys.length} of ${SEED.taskKeys.length} tasks done`,
      LIVE,
    );

    const photo = p.getByTestId('photo-hvac');
    await expect(photo).toContainText('+ Photo');
    await expectRpc(
      p,
      'add_visit_photo',
      async () => {
        const chooser = p.waitForEvent('filechooser');
        await photo.click();
        await (await chooser).setFiles(FILTER_JPG);
      },
      { p_kind: 'before' },
    );
    await expect(photo).toContainText('✓ Photo');
  });

  test('Complete → Elena sees "Visit complete"', async () => {
    const complete = tech.page.getByTestId('visit-complete').getByRole('button');
    await expect(complete).toBeEnabled();
    await expectRpc(tech.page, 'complete_visit', () => complete.click(), { p_visit: SEED.visits.elena });
    await expect(complete).toContainText('Report sent ✓');
    await expect(home.page.getByTestId('tech-banner')).toContainText('Visit complete', LIVE);
    await expectNoReload(home.page);
  });

  test('Elena opens the report: health score and the uploaded photo', async () => {
    const p = home.page;
    await p.getByRole('tab', { name: 'Reports' }).click();
    const card = p.getByTestId('report-card');
    await expect(card).toBeVisible();
    await card.first().click();
    await expect(p.getByText('Home health')).toBeVisible();
    // RemotePhoto renders an <img> only once the signed Storage URL has loaded.
    await expect
      .poll(
        () =>
          p.evaluate(
            () =>
              Array.from(document.images).filter((img) => img.src.includes('/storage/v1/') && img.complete && img.naturalWidth > 0)
                .length,
          ),
        { timeout: 20_000, message: 'a loaded photo from Supabase Storage' },
      )
      .toBeGreaterThan(0);
  });
});
