/**
 * @module web/e2e/smoke
 * The app shell loads from the API, at / and from a deep link, in every
 * browser and size (Step 10). Later steps add the real flows.
 */

import { expect, test } from './fixtures';

test('the app loads at /', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('link', { name: 'Mise en place' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Recipes' })).toBeVisible();
});

test('a deep link loads the app at that page', async ({ page }) => {
    await page.goto('/options/ingredients');

    await expect(page.getByRole('heading', { level: 1, name: 'Ingredients' })).toBeVisible();
});

test('the header links work', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Options' }).click();

    await expect(page).toHaveURL(/\/options$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Options' })).toBeVisible();

    await page.getByRole('link', { name: 'Mise en place' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Recipes' })).toBeVisible();
});

test('the API still answers alongside the app', async ({ request }) => {
    const response = await request.get('/api/health');

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
});
