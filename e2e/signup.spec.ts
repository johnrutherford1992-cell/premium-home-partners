// "New customer" sign-up on the live launcher: the form (first name, last
// name, email, optional phone) turns the onboarding demo account (Jordan Lee,
// newhome@php.test) into a brand-new customer under the typed name
// (rpc start_new_customer) and opens onboarding on step 1 with the name
// filled in. One password sign-in (Jordan) per run.

import { expect, test } from './fixtures';
import { SEED, api, expectAccount, expectRpc, requireBackend, resetDemo, shown } from './helpers';

const NEW = { first: 'Taylor', last: 'Kim', email: 'taylor.kim@example.com', phone: '(214) 555-0100' };

test.describe.serial('sign-up: a new customer from the launcher', () => {
  requireBackend();

  test.beforeAll(async () => {
    await resetDemo();
  });

  // Jordan is the onboarding demo again for whatever runs next.
  test.afterAll(async () => {
    await resetDemo();
  });

  test('launcher → New customer → the form → onboarding step 1 with the name filled in', async ({ page }) => {
    await page.goto('/');
    await shown(page.getByTestId('launch-signup')).click();
    await expect(page).toHaveURL(/\/signup\/?$/);

    const field = (id: string) => shown(page.getByTestId(id));
    const submit = field('signup-submit');
    await expect(submit).toHaveText('Create account');

    // Nothing is sent until the required fields are right.
    await submit.click();
    await expect(shown(page.getByText('Enter your first name.'))).toBeVisible();
    await expect(shown(page.getByText('Enter your last name.'))).toBeVisible();
    await expect(shown(page.getByText('Enter your email.'))).toBeVisible();
    await field('signup-first-name').fill(NEW.first);
    await field('signup-last-name').fill(NEW.last);
    await field('signup-email').fill('taylor.kim@');
    await submit.click();
    await expect(shown(page.getByText('Enter an email like name@example.com.'))).toBeVisible();
    await expect(page).toHaveURL(/\/signup\/?$/);

    await field('signup-email').fill(NEW.email);
    await field('signup-phone').fill(NEW.phone);
    await expectRpc(page, 'start_new_customer', () => submit.click(), { p_full_name: `${NEW.first} ${NEW.last}`, p_phone: NEW.phone });

    await expect(page).toHaveURL(/\/homeowner\/onboarding\/?$/, { timeout: 30_000 });
    await expectAccount(page, 'newhome');
    await expect(shown(page.getByText('1 / 5', { exact: true }))).toBeVisible();
    await expect(shown(page.getByLabel('YOUR NAME', { exact: true }))).toHaveValue(`${NEW.first} ${NEW.last}`);
    await expect(shown(page.getByLabel('SERVICE ADDRESS', { exact: true }))).toHaveValue('');
    await expect(shown(page.getByTestId('signup-error'))).toHaveCount(0);
  });

  test('the server has a brand-new customer: the new name and phone, no home', async () => {
    const office = await api('office');
    const { data: profile, error } = await office.from('profiles').select('full_name, phone').eq('id', SEED.users.jordan).single();
    expect(error).toBeNull();
    expect(profile).toEqual({ full_name: `${NEW.first} ${NEW.last}`, phone: NEW.phone });
    const { count, error: homesError } = await office.from('homes').select('id', { count: 'exact', head: true }).eq('owner_id', SEED.users.jordan);
    expect(homesError).toBeNull();
    expect(count).toBe(0);
  });
});
